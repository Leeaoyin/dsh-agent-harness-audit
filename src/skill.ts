/**
 * Registers the bundled `harness-evaluation` skill and verifies it is
 * actually reachable afterwards.
 *
 * Two distinct filesystems are in play and conflating them is a real bug:
 * the skill files ship INSIDE this package, which generally sits outside the
 * audited workspace, so they are read with `node:fs` at load time. Everything
 * that touches the workspace under audit (evidence validation, report writes)
 * goes through `ctx.fs`, which a sandboxing backend is entitled to fence.
 *
 * @module dsh-harness-audit/skill
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

/** Where the skill body resolved from, recorded in run metadata. */
export interface SkillOrigin {
  /** Provider that won the name — `runtime` means our bundled copy won. */
  provider: string
  /** Discovery bucket reported by the winning provider. */
  source: string
  /** Absolute path when the winner came from disk. */
  path?: string
  /** True when a project-level provider shadowed the bundled copy. */
  overridden: boolean
}

interface Frontmatter {
  name: string
  description: string
  whenToUse?: string
  body: string
}

/** Absolute path to the skill directory shipped in this package. */
export function bundledSkillDir(): string {
  // Resolves identically from `lib/` (published) and `src/` (dev overlay).
  return fileURLToPath(new URL('../skills/harness-evaluation/', import.meta.url))
}

/**
 * Parse the leading YAML frontmatter block. Deliberately minimal: it reads the
 * flat scalar keys the skill contract requires and leaves everything else to
 * the body, rather than pulling a YAML dependency into plugin load.
 */
export function parseFrontmatter(raw: string): Frontmatter {
  const text = raw.replace(/^﻿/u, '')
  const lines = text.split(/\r?\n/u)
  if (lines[0]?.trim() !== '---') {
    throw new Error('SKILL.md is missing its opening `---` frontmatter fence')
  }
  const closing = lines.indexOf('---', 1)
  if (closing === -1) throw new Error('SKILL.md frontmatter is never closed by a `---` fence')

  const data = new Map<string, string>()
  let key: string | undefined
  for (const line of lines.slice(1, closing)) {
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/u.exec(line)
    if (match !== null) {
      key = match[1]
      const value = match[2].trim()
      // Block scalar indicators (`>`, `|`, and their chomping variants) carry
      // no text of their own — the value is the indented block that follows.
      data.set(key, /^[>|][-+]?\d*$/u.test(value) ? '' : stripQuotes(value))
      continue
    }
    // Continuation of the previous scalar: a wrapped value or a block body.
    const continued = line.trim()
    if (key !== undefined && continued.length > 0) {
      const prefix = data.get(key) ?? ''
      data.set(key, prefix.length === 0 ? stripQuotes(continued) : `${prefix} ${continued}`)
    }
  }

  const name = data.get('name')
  const description = data.get('description')
  if (name === undefined || name.length === 0) throw new Error('SKILL.md frontmatter requires `name`')
  if (description === undefined || description.length === 0) {
    throw new Error('SKILL.md frontmatter requires `description`')
  }
  const whenToUse = data.get('whenToUse')
  return {
    name,
    description,
    ...whenToUse !== undefined && whenToUse.length > 0 ? { whenToUse } : {},
    body: lines.slice(closing + 1).join('\n'),
  }
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Read and register the bundled skill. Throws synchronously when the files are
 * absent so the plugin fails at LOAD time.
 *
 * This is the guard for a genuinely silent packaging failure: drop `skills`
 * from package.json `files` and the plugin still loads, still registers its
 * command, and every audit quietly returns nothing.
 */
export function registerBundledSkill(ctx: Context): { name: string } {
  const dir = bundledSkillDir()
  const skillPath = `${dir}SKILL.md`
  if (!existsSync(skillPath)) {
    throw new Error(
      `dsh-harness-audit: bundled skill missing at ${skillPath}. `
      + 'Place SKILL.md and references/ there, and keep "skills" in package.json "files".',
    )
  }

  const parsed = parseFrontmatter(readFileSync(skillPath, 'utf8'))

  const referencesDir = `${dir}references`
  if (existsSync(referencesDir)) {
    const refs = readdirSync(referencesDir).filter((f) => f.endsWith('.md'))
    if (refs.length === 0) ctx.logger.warn('harness-evaluation: references/ contains no markdown files')
  } else {
    ctx.logger.warn('harness-evaluation: no references/ directory; reference-dependent guidance will be unavailable')
  }

  ctx.effect(() => ctx.skills.register({
    name: parsed.name,
    description: parsed.description,
    ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
    content: parsed.body,
    source: 'bundled',
    path: skillPath,
    // Lets the skill body reference `references/*.md` relatively.
    resourceBase: { kind: 'directory', path: dir },
    // modelInvocable is REQUIRED: audit subagents must be able to load it.
    // userInvocable lets a human run a one-off audit without the command.
    invocation: { modelInvocable: true, userInvocable: true },
  }))

  return { name: parsed.name }
}

/**
 * Confirm the skill name actually resolves, and report which provider won.
 *
 * `register()` is first-come-first-served within a layer and hands back a
 * no-op disposer on a duplicate, so a successful call proves nothing on its
 * own. A project-level provider outranking our rank-250 runtime copy is a
 * supported feature, not an error — but the run must record which criteria it
 * actually used, or a bad report cannot be traced to criteria vs orchestration.
 */
export async function resolveSkillOrigin(
  ctx: Context,
  skillName: string,
  options: { cwd?: string; signal?: AbortSignal } = {},
): Promise<SkillOrigin> {
  const skill = await ctx.skills.get(skillName, options)
  if (skill === undefined) {
    throw new Error(
      `dsh-harness-audit: skill "${skillName}" did not resolve after registration. `
      + 'Another provider may have claimed the name, or config.skillName points at a skill that does not exist.',
    )
  }
  return {
    provider: skill.provider,
    source: skill.source,
    ...skill.path !== undefined ? { path: skill.path } : {},
    overridden: skill.provider !== 'runtime',
  }
}
