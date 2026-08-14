/**
 * Report rendering and output.
 *
 * The Markdown follows the report template in the skill's "Report template"
 * section verbatim in structure — headings, per-finding shape, and the
 * mandatory "Not covered" and "Cost" sections. That is deliberate: a hand-run
 * audit and a plugin-run audit must produce the same document, so the plugin
 * renders the skill's template rather than inventing a format.
 *
 * Two additions the template does not name: a "Not implemented" section
 * (the verdict exists in the skill's taxonomy but the template only shows
 * Confirmed and Suspected), and an appendix carrying the landmark table. The
 * JSON report carries everything unconditionally.
 *
 * @module dsh-harness-audit/render
 */

import type { Context } from '@deepseek-ai/cordis'
import { CHECK_BY_ID, GROUPS } from './checks.ts'
import type { AuditResult } from './orchestrate.ts'
import type { CheckOutcome, Finding, Landmark, Usage } from './state.ts'

function usageLine(usage: Usage): string {
  return `input ${usage.inputTokens}, output ${usage.outputTokens}`
    + `, cache read ${usage.cacheReadTokens}, cache write ${usage.cacheWriteTokens}`
    + (usage.reasoningTokens > 0 ? `, reasoning ${usage.reasoningTokens}` : '')
}

function fenceLanguage(file: string): string {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', py: 'python', go: 'go',
    rs: 'rust', java: 'java', rb: 'ruby', cs: 'csharp', kt: 'kotlin',
  }
  return map[ext] ?? ''
}

/** One finding in the template's shape. */
function renderFinding(finding: Finding): string {
  const lines = [
    `**${finding.file}:${finding.line}**`,
    finding.claim,
    '',
    // A fence inside the excerpt would end the block early and let the rest of
    // the model's text render as document structure.
    '```' + fenceLanguage(finding.file),
    finding.evidence.replace(/```/gu, '` ` `'),
    '```',
    '',
    `Consequence: ${finding.consequence}`,
  ]
  if (finding.direction !== undefined) lines.push(`Direction: ${finding.direction}`)
  if (finding.confirmHint !== undefined) lines.push(`To confirm, check ${finding.confirmHint}`)
  return lines.join('\n')
}

/** Findings for one verdict, grouped under `### C<n> · <check name>`. */
function renderVerdictSection(findings: readonly Finding[]): string[] {
  const out: string[] = []
  let currentCheck = ''
  for (const finding of findings) {
    if (finding.check !== currentCheck) {
      currentCheck = finding.check
      const check = CHECK_BY_ID.get(finding.check)
      out.push(`### ${finding.check} · ${check?.name ?? ''}`, '')
    }
    out.push(renderFinding(finding), '')
  }
  return out
}

/**
 * One line per check group with its highest verdict, as the template asks.
 * A group whose checks all failed to run reports "not covered" rather than a
 * clean verdict — the distinction the skill's evidence rules insist on.
 */
function renderGroupSummary(findings: readonly Finding[], outcomes: readonly CheckOutcome[]): string[] {
  const rank = (v: string): number => (v === 'confirmed' ? 3 : v === 'suspected' ? 2 : 1)
  const label = (r: number): string => (r === 3 ? 'confirmed' : r === 2 ? 'suspected' : 'not-implemented')
  const selected = new Set(outcomes.map((o) => o.id))
  const ran = new Set(outcomes.filter((o) => o.status === 'ran').map((o) => o.id))

  const lines: string[] = []
  for (const group of GROUPS) {
    const ids = [...CHECK_BY_ID.values()].filter((c) => c.group === group && selected.has(c.id)).map((c) => c.id)
    if (ids.length === 0) continue
    const groupFindings = findings.filter((f) => ids.includes(f.check))
    const ranIds = ids.filter((id) => ran.has(id))
    let verdict: string
    if (ranIds.length === 0) verdict = 'not covered'
    else if (groupFindings.length === 0) verdict = `no findings (${ranIds.length}/${ids.length} checked)`
    else verdict = `${label(Math.max(...groupFindings.map((f) => rank(f.verdict))))} (${groupFindings.length} finding${groupFindings.length === 1 ? '' : 's'})`
    lines.push(`- **${group}** — ${verdict}`)
  }
  return lines
}

function renderLandmarks(landmarks: readonly Landmark[]): string {
  if (landmarks.length === 0) return '_No landmarks were located._'
  const rows = [...landmarks]
    .sort((a, b) => (a.kind === b.kind ? a.file.localeCompare(b.file) : a.kind.localeCompare(b.kind)))
    .map((l) => `| ${l.kind} | \`${l.file}:${l.line}\` | ${l.symbol ?? '—'} | ${l.confidence} |`)
  return ['| Kind | Location | Symbol | Confidence |', '|---|---|---|---|', ...rows].join('\n')
}

export function renderMarkdown(result: AuditResult): string {
  const { meta, findings, outcomes } = result
  const out: string[] = []

  const confirmed = findings.filter((f) => f.verdict === 'confirmed')
  const suspected = findings.filter((f) => f.verdict === 'suspected')
  const notImplemented = findings.filter((f) => f.verdict === 'not-implemented')

  out.push('# Harness robustness audit', '')
  out.push(`Target: ${meta.workspaceRoot}${meta.commit === undefined ? '' : ` @ ${meta.commit}`}`)
  out.push(`Checks run: ${meta.ranChecks.length}    Findings: ${confirmed.length} confirmed / ${suspected.length} suspected`, '')

  out.push('## Summary', '')
  out.push(...renderGroupSummary(findings, outcomes), '')

  out.push('## Confirmed', '')
  if (confirmed.length === 0) out.push('None.', '')
  else out.push(...renderVerdictSection(confirmed))

  out.push('## Suspected', '')
  if (suspected.length === 0) out.push('None.', '')
  else out.push(...renderVerdictSection(suspected))

  if (notImplemented.length > 0) {
    out.push('## Not implemented', '')
    out.push('These subsystems are absent. That is not a pass.', '')
    out.push(...renderVerdictSection(notImplemented))
  }

  // Mandatory. A short-circuited check must never read as "checked, clean".
  out.push('## Not covered', '')
  const skipped = outcomes.filter((o) => o.status !== 'ran')
  const notSelected = [...CHECK_BY_ID.keys()].filter((id) => !outcomes.some((o) => o.id === id))
  if (skipped.length === 0 && notSelected.length === 0) {
    out.push('Every check was evaluated.', '')
  } else {
    out.push('Nothing below was examined. Absence of findings for these means nothing was', 'looked at — not that nothing is wrong.', '')
    if (skipped.length > 0) {
      out.push('| Check | Name | Why it could not be evaluated |', '|---|---|---|')
      for (const outcome of skipped) {
        const check = CHECK_BY_ID.get(outcome.id)
        const why = outcome.status === 'skipped-missing-landmarks'
          ? `required landmark(s) not located: ${outcome.missingLandmarks.join(', ')}`
          : `subagent failed: ${outcome.error ?? 'unknown error'}`
        out.push(`| ${outcome.id} | ${check?.name ?? ''} | ${why} |`)
      }
      out.push('')
    }
    if (notSelected.length > 0) {
      out.push(`Not selected for this run: ${notSelected.join(', ')}.`, '')
    }
  }

  out.push('## Cost', '')
  out.push(`Total: ${usageLine(meta.totalUsage)} over ${(meta.durationMs / 1000).toFixed(1)}s.`, '')
  out.push('| Stage | Status | Findings | Rejected | Tokens (in/out) |', '|---|---|---|---|---|')
  out.push(`| _recon_ | ran | — | — | ${meta.reconUsage.inputTokens}/${meta.reconUsage.outputTokens} |`)
  for (const outcome of outcomes) {
    out.push(`| ${outcome.id} | ${outcome.status} | ${outcome.findingCount} | ${outcome.rejectionCount} | ${outcome.usage.inputTokens}/${outcome.usage.outputTokens} |`)
  }
  out.push(`| **total** | | ${meta.findingCount} | ${meta.evidenceRejections} | **${meta.totalUsage.inputTokens}/${meta.totalUsage.outputTokens}** |`, '')

  if (meta.evidenceRejections > 0) {
    const detail = Object.entries(meta.rejectionsByReason).map(([reason, count]) => `${reason}: ${count}`).join(', ')
    out.push(`> ${meta.evidenceRejections} submitted finding(s) were refused by evidence validation (${detail}).`)
    out.push('> A high rejection rate means the subagents are fabricating; fix the prompts, not the validation.', '')
  }

  out.push('## Appendix — run detail', '')
  out.push(`- Criteria: skill \`${meta.skillName}\` via provider \`${meta.skill.provider}\` (${meta.skill.source})${meta.skill.overridden ? ' — **overridden by a project provider**' : ''}`)
  out.push(`- Primary language: ${meta.language ?? 'undetermined'}`)
  out.push(`- Subagents: ${meta.subagentProvider}, concurrency ${meta.concurrency}`)
  out.push(`- LSP: ${meta.lspAvailable === 'not-probed' ? 'not probed' : meta.lspAvailable ? 'available' : 'unavailable — text search only'}`)
  out.push('')
  out.push('### Landmarks', '', renderLandmarks(result.run.landmarks), '')

  out.push('---', '')
  out.push('This report covers Mode A (audit) only. To build a regression suite from these', `findings, see the "After the audit" section of the \`${meta.skillName}\` skill.`, '')

  return out.join('\n')
}

export function renderJson(result: AuditResult): string {
  return `${JSON.stringify({
    meta: result.meta,
    landmarks: result.run.landmarks,
    findings: result.findings,
    outcomes: result.outcomes,
    rejections: result.run.rejections,
  }, null, 2)}\n`
}

/** Write both reports; returns their workspace-relative paths. */
export async function writeReports(
  ctx: Context,
  result: AuditResult,
  outputDir: string,
  signal?: AbortSignal,
): Promise<{ json: string; markdown: string }> {
  const stamp = result.meta.startedAt.replace(/[:.]/gu, '-')
  const jsonPath = `${outputDir}/report-${stamp}.json`
  const mdPath = `${outputDir}/report-${stamp}.md`
  const cwd = result.meta.workspaceRoot

  // writeText creates missing parent directories.
  const jsonTarget = await ctx.fs.resolve(jsonPath, { cwd, signal })
  await ctx.fs.writeText(jsonTarget, renderJson(result), undefined, signal)

  const mdTarget = await ctx.fs.resolve(mdPath, { cwd, signal })
  await ctx.fs.writeText(mdTarget, renderMarkdown(result), undefined, signal)

  return { json: jsonPath, markdown: mdPath }
}
