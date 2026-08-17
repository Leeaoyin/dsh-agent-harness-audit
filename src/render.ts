/**
 * Report rendering and output.
 *
 * Structure is fixed: headings, per-finding shape, and the mandatory
 * "Not covered" and "Cost" sections, so two runs are comparable and a reader
 * always finds the same thing in the same place. The JSON report carries
 * everything unconditionally.
 *
 * @module dsh-harness-audit/render
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only side-effect import: loads the `ctx.fs` augmentation of Context
// without emitting a runtime import.
import type {} from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { CHECK_BY_ID, GROUPS } from './checks.ts'
import type { Landmark } from './checks.ts'
import type { AuditResult } from './orchestrate.ts'
import type { Messages } from './i18n.ts'
import type { CheckOutcome, Finding, Usage } from './state.ts'

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
function renderFinding(finding: Finding, m: Messages): string {
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
    `${m.consequence}: ${finding.consequence}`,
  ]
  if (finding.direction !== undefined) lines.push(`${m.direction}: ${finding.direction}`)
  if (finding.confirmHint !== undefined) lines.push(`${m.toConfirm} ${finding.confirmHint}`)
  return lines.join('\n')
}

/** Findings for one verdict, grouped under `### C<n> · <check name>`. */
function renderVerdictSection(findings: readonly Finding[], m: Messages): string[] {
  const out: string[] = []
  let currentCheck = ''
  for (const finding of findings) {
    if (finding.check !== currentCheck) {
      currentCheck = finding.check
      const check = CHECK_BY_ID.get(finding.check)
      out.push(`### ${finding.check} · ${check?.name ?? ''}`, '')
    }
    out.push(renderFinding(finding, m), '')
  }
  return out
}

/**
 * One line per check group with its highest verdict, as the template asks.
 * A group whose checks all failed to run reports "not covered" rather than a
 * clean verdict — the distinction the evidence rules insist on.
 */
function renderGroupSummary(findings: readonly Finding[], outcomes: readonly CheckOutcome[], m: Messages): string[] {
  const rank = (v: string): number => (v === 'confirmed' ? 3 : v === 'suspected' ? 2 : 1)
  const label = (r: number): string => (r === 3 ? m.verdictConfirmed : r === 2 ? m.verdictSuspected : m.verdictNotImplemented)
  const selected = new Set(outcomes.map((o) => o.id))
  const ran = new Set(outcomes.filter((o) => o.status === 'ran').map((o) => o.id))

  const lines: string[] = []
  for (const group of GROUPS) {
    const ids = [...CHECK_BY_ID.values()].filter((c) => c.group === group && selected.has(c.id)).map((c) => c.id)
    if (ids.length === 0) continue
    const groupFindings = findings.filter((f) => ids.includes(f.check))
    const ranIds = ids.filter((id) => ran.has(id))
    let verdict: string
    if (ranIds.length === 0) verdict = m.groupNotCovered
    else if (groupFindings.length === 0) verdict = m.groupNoFindings(ranIds.length, ids.length)
    else verdict = m.groupVerdict(label(Math.max(...groupFindings.map((f) => rank(f.verdict)))), groupFindings.length)
    lines.push(`- **${group}** — ${verdict}`)
  }
  return lines
}

function renderLandmarks(landmarks: readonly Landmark[], m: Messages): string {
  if (landmarks.length === 0) return m.noLandmarks
  const rows = [...landmarks]
    .sort((a, b) => (a.kind === b.kind ? a.file.localeCompare(b.file) : a.kind.localeCompare(b.kind)))
    .map((l) => `| ${l.kind} | \`${l.file}:${l.line}\` | ${l.symbol ?? '—'} | ${l.confidence} |`)
  return ['| Kind | Location | Symbol | Confidence |', '|---|---|---|---|', ...rows].join('\n')
}

export function renderMarkdown(result: AuditResult, m: Messages): string {
  const { meta, findings, outcomes } = result
  const out: string[] = []

  const confirmed = findings.filter((f) => f.verdict === 'confirmed')
  const suspected = findings.filter((f) => f.verdict === 'suspected')
  const notImplemented = findings.filter((f) => f.verdict === 'not-implemented')

  out.push(`# ${m.reportTitle}`, '')
  out.push(`${m.target}: ${meta.workspaceRoot}${meta.commit === undefined ? '' : ` @ ${meta.commit}`}`)
  out.push(m.checksRunLine(meta.ranChecks.length, confirmed.length, suspected.length), '')

  out.push(`## ${m.secSummary}`, '')
  out.push(...renderGroupSummary(findings, outcomes, m), '')

  out.push(`## ${m.secConfirmed}`, '')
  if (confirmed.length === 0) out.push(m.none, '')
  else out.push(...renderVerdictSection(confirmed, m))

  out.push(`## ${m.secSuspected}`, '')
  if (suspected.length === 0) out.push(m.none, '')
  else out.push(...renderVerdictSection(suspected, m))

  if (notImplemented.length > 0) {
    out.push(`## ${m.secNotImplemented}`, '')
    out.push(m.notImplementedNote, '')
    out.push(...renderVerdictSection(notImplemented, m))
  }

  // Mandatory. A short-circuited check must never read as "checked, clean".
  out.push(`## ${m.secNotCovered}`, '')
  const skipped = outcomes.filter((o) => o.status !== 'ran')
  const notSelected = [...CHECK_BY_ID.keys()].filter((id) => !outcomes.some((o) => o.id === id))
  if (skipped.length === 0 && notSelected.length === 0) {
    out.push(m.everythingEvaluated, '')
  } else {
    out.push(m.notCoveredWarning, '')
    if (skipped.length > 0) {
      out.push(m.notCoveredTableHead, '|---|---|---|')
      for (const outcome of skipped) {
        const check = CHECK_BY_ID.get(outcome.id)
        const why = outcome.status === 'skipped-missing-landmarks'
          ? m.whyMissingLandmarks(outcome.missingLandmarks.join(', '))
          : m.whySubagentFailed(outcome.error ?? 'unknown error')
        out.push(`| ${outcome.id} | ${check?.name ?? ''} | ${why} |`)
      }
      out.push('')
    }
    if (notSelected.length > 0) {
      out.push(m.notSelected(notSelected.join(', ')), '')
    }
  }

  out.push(`## ${m.secCost}`, '')
  out.push(m.costTotal(usageLine(meta.totalUsage), (meta.durationMs / 1000).toFixed(1)), '')
  out.push(m.costTableHead, '|---|---|---|---|---|')
  out.push(`| ${m.stageRecon} | ran | — | — | ${meta.reconUsage.inputTokens}/${meta.reconUsage.outputTokens} |`)
  for (const outcome of outcomes) {
    out.push(`| ${outcome.id} | ${outcome.status} | ${outcome.findingCount} | ${outcome.rejectionCount} | ${outcome.usage.inputTokens}/${outcome.usage.outputTokens} |`)
  }
  out.push(`| ${m.stageTotal} | | ${meta.findingCount} | ${meta.evidenceRejections} | **${meta.totalUsage.inputTokens}/${meta.totalUsage.outputTokens}** |`, '')

  if (meta.evidenceRejections > 0) {
    const detail = Object.entries(meta.rejectionsByReason).map(([reason, count]) => `${reason}: ${count}`).join(', ')
    out.push(m.rejectionNote(meta.evidenceRejections, detail))
    out.push(m.rejectionWarning, '')
  }

  out.push(`## ${m.secAppendix}`, '')
  // The report carried no wall-clock time at all before this — only a
  // duration — so nothing in the document said when it was produced.
  out.push(m.ranAtLine(localDisplay(meta.startedAt)))
  out.push(m.languageLine(meta.language ?? 'undetermined'))
  out.push(m.subagentsLine(meta.subagentProvider, meta.concurrency))
  out.push(m.scopeLine(meta.excludePaths.length === 0 ? undefined : meta.excludePaths.join(', ')))
  out.push(m.lspLine(meta.lspAvailable === 'not-probed' ? 'not-probed' : meta.lspAvailable ? 'available' : 'unavailable'))
  out.push('')
  out.push(`### ${m.secLandmarks}`, '', renderLandmarks(result.run.landmarks, m), '')

  out.push('---', '')
  out.push(m.modeANote(), '')



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

/** Ids listed individually in a filename before it collapses to a count. */
const SCOPE_IDS_IN_NAME = 3

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/**
 * Filename timestamp in LOCAL time.
 *
 * The ISO instant is kept in the JSON as the machine-readable record, but a
 * filename is read by a human scanning a directory, and a UTC stamp there is
 * simply wrong to them: a run at 20:43 local was named `...T12-43-49-845Z`.
 * No `Z` and no `T` here — those spellings claim UTC, and this is not UTC.
 *
 * @param iso - the run's start instant, ISO 8601.
 * @returns `YYYY-MM-DD_HHMMSS` in the host's zone, still sorting chronologically.
 */
export function localStamp(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/**
 * Human-readable run time: local clock plus the offset that produced it.
 *
 * The offset is printed rather than assumed. A report outlives the machine
 * that made it, and `2026-08-17 10:15:30` alone cannot be reconciled with the
 * ISO instant beside it in the JSON.
 */
export function localDisplay(iso: string): string {
  const d = new Date(iso)
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin < 0 ? '-' : '+'
  const abs = Math.abs(offsetMin)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} `
    + `(UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)})`
}

/**
 * Filename suffix naming what the report covers.
 *
 * A directory of `report-<timestamp>` files is unreadable once there is more
 * than one: every audit looks alike, and finding the C1 run means opening
 * them. The dimensions go in the name so the listing answers that.
 *
 * Long selections collapse to a count rather than concatenating fifteen ids —
 * a filename nobody can read is no better than one that says nothing, and
 * some filesystems cap the component length.
 *
 * @param ids - the check ids this run covered, selected rather than merely run
 *   (a dimension reported as not covered is still what the report is about).
 * @returns a path-safe suffix, e.g. `C1`, `C1-C9`, or `4checks`.
 */
export function fileScopeSuffix(ids: readonly string[]): string {
  const ordered = [...ids].sort((a, b) => Number.parseInt(a.slice(1), 10) - Number.parseInt(b.slice(1), 10))
  if (ordered.length === 0) return 'none'
  if (ordered.length <= SCOPE_IDS_IN_NAME) return ordered.join('-')
  return `${ordered.length}checks`
}

/**
 * Write both reports; returns their workspace-relative paths.
 *
 * `sandboxPolicy` is required in practice even though the parameter is
 * optional: omitting it leaves the backend its own default, and under a
 * `workspace-write` deployment that default refused the write outright
 * (`file access denied under workspace-write mode`) even though the target
 * sits inside the workspace. The caller resolves the session's effective
 * policy so the write runs under the mode the user actually chose.
 */
export async function writeReports(
  ctx: Context,
  result: AuditResult,
  outputDir: string,
  m: Messages,
  signal?: AbortSignal,
  sandboxPolicy?: SandboxExecutionPolicy,
): Promise<{ json: string; markdown: string }> {
  const stamp = localStamp(result.meta.startedAt)
  const scope = fileScopeSuffix(result.outcomes.map((o) => o.id))
  const jsonPath = `${outputDir}/report-${stamp}-${scope}.json`
  const mdPath = `${outputDir}/report-${stamp}-${scope}.md`
  const cwd = result.meta.workspaceRoot
  // `exactOptionalPropertyTypes` rejects an explicit `signal: undefined`, so
  // the key is omitted rather than passed empty.
  const opts = { cwd, ...signal === undefined ? {} : { signal } }

  // writeText creates missing parent directories.
  const jsonTarget = await ctx.fs.resolve(jsonPath, opts)
  await ctx.fs.writeText(jsonTarget, renderJson(result), undefined, signal, sandboxPolicy)

  const mdTarget = await ctx.fs.resolve(mdPath, opts)
  await ctx.fs.writeText(mdTarget, renderMarkdown(result, m), undefined, signal, sandboxPolicy)

  return { json: jsonPath, markdown: mdPath }
}
