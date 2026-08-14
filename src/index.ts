/**
 * dsh-harness-audit — audits an agent harness against the criteria in the
 * `harness-evaluation` skill.
 *
 * The split is deliberate: the SKILL owns every judgment criterion, and this
 * plugin owns only the machine parts — the command entry point, the
 * orchestration, evidence validation, and deterministic summarisation.
 * Changing what counts as a defect is a markdown edit, not a release.
 *
 * @module dsh-harness-audit
 */

import type { Context } from '@deepseek-ai/cordis'
import { CHECKS } from './checks.ts'
import { Config } from './config.ts'
import { registerReportFinding } from './findings.ts'
import { runAudit } from './orchestrate.ts'
import { registerReportLandmark } from './recon.ts'
import { writeReports } from './render.ts'
import { registerBundledSkill, resolveSkillOrigin } from './skill.ts'
import { ActiveRun } from './state.ts'

export { Config } from './config.ts'
export { CHECKS } from './checks.ts'

export const name = 'harness-audit'

export const inject = ['skills', 'commands', 'subagents', 'tools', 'fs']

/** Parse `--checks C1,C9,C14` out of the command's raw input. */
function parseChecksFlag(rawInput: string): string[] {
  const match = /--checks[=\s]+([A-Za-z0-9,\s]+)/u.exec(rawInput)
  if (match === null) return []
  return match[1].split(/[,\s]+/u).map((s) => s.trim()).filter((s) => s.length > 0)
}

export function apply(ctx: Context, config: Config): void {
  // Throws synchronously when the skill files are absent, so a packaging
  // mistake fails at load instead of yielding silently empty audits.
  registerBundledSkill(ctx)

  const active = new ActiveRun()
  registerReportLandmark(ctx, active)
  registerReportFinding(ctx, active)

  // Second half of the self-check: register() is first-come-first-served and
  // returns a no-op disposer on a duplicate, so a successful call does not
  // prove the name resolves to our copy.
  void resolveSkillOrigin(ctx, config.skillName).then(
    (origin) => {
      if (origin.overridden) {
        ctx.logger.info(`harness-audit: criteria come from provider "${origin.provider}" (${origin.source}), not the bundled copy`)
      }
    },
    (error: unknown) => {
      ctx.logger.error(`harness-audit: ${error instanceof Error ? error.message : String(error)}`)
    },
  )

  ctx.effect(() => ctx.commands.register({
    name: 'harness-audit',
    description: `Audit this workspace's agent harness against the ${config.skillName} criteria.`,
    input: { hint: '[--checks C1,C9,C14]' },
    async handler(invocation) {
      if (active.current !== undefined) {
        return { kind: 'error', text: 'an audit is already in progress' }
      }

      const requestedChecks = parseChecksFlag(invocation.rawInput)
      try {
        const result = await runAudit(ctx, config, active, {
          agent: invocation.agent,
          signal: invocation.signal,
          requestedChecks,
        })
        const paths = await writeReports(ctx, result, config.outputDir, invocation.signal)

        const { meta } = result
        const summary = [
          `Audit complete: ${meta.findingCount} finding(s) across ${meta.ranChecks.length} check(s).`,
          meta.skippedChecks.length > 0 ? `Not covered: ${meta.skippedChecks.join(', ')}.` : '',
          meta.evidenceRejections > 0 ? `${meta.evidenceRejections} submission(s) refused by evidence validation.` : '',
          `Cost: ${meta.totalUsage.inputTokens} in / ${meta.totalUsage.outputTokens} out.`,
          `Reports: ${paths.markdown}, ${paths.json}`,
        ].filter((line) => line.length > 0).join(' ')

        return { kind: 'success', text: summary }
      } catch (error) {
        return { kind: 'error', text: `harness audit failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  }))

  ctx.logger.info(`harness-audit ready: ${CHECKS.length} checks defined, criteria from skill "${config.skillName}"`)
}
