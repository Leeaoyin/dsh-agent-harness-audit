/**
 * `report_finding` and its evidence validation.
 *
 * Criteria can only ASK a model for a file and line in prose; a tool can
 * refuse the submission. Rule 4 in particular — the quoted evidence must
 * actually occur near the cited line — is what keeps a model from inventing a
 * passage that merely looks like code.
 *
 * The rejection rate is the single most important observability signal here.
 * A high rate means the subagents are fabricating and the PROMPTS need work;
 * it is never a reason to loosen validation.
 *
 * @module dsh-harness-audit/findings
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only side-effect import: loads the `ctx.fs` augmentation of Context.
import type {} from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { excludedBy, excludedMessage } from './scope.ts'
import type { ActiveRun, RejectionReason, Verdict } from './state.ts'

const VERDICTS: readonly string[] = ['confirmed', 'suspected', 'not-implemented']

/** Lines of slack allowed between the cited line and the quoted evidence. */
const EVIDENCE_WINDOW = 3

/** Collapse indentation and internal whitespace runs; keep the actual text. */
function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/gu, ' ')
}

/**
 * Compare on normalized, blank-stripped text rather than byte equality.
 * Requiring an exact match would reject on indentation alone and produce a
 * flood of false refusals, which teaches nothing about fabrication.
 */
export function evidenceMatches(fileText: string, line: number, evidence: string): boolean {
  const evidenceLines = evidence.split(/\r?\n/u).map(normalizeLine).filter((l) => l.length > 0)
  if (evidenceLines.length === 0) return false

  const fileLines = fileText.split(/\r?\n/u)
  const zeroBased = line - 1
  const start = Math.max(0, zeroBased - EVIDENCE_WINDOW)
  const end = Math.min(fileLines.length, zeroBased + evidenceLines.length + EVIDENCE_WINDOW)

  const haystack = fileLines.slice(start, end).map(normalizeLine).filter((l) => l.length > 0).join(' ')
  return haystack.includes(evidenceLines.join(' '))
}

function refuse(reason: RejectionReason, detail: string, remedy: string): { reason: RejectionReason; detail: string; text: string } {
  return { reason, detail, text: `REJECTED (${reason}): ${detail} ${remedy}` }
}

export function registerReportFinding(ctx: Context, active: ActiveRun): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'report_finding',
    description:
      'Report one audit finding. Call once per finding. Do NOT call it when you found nothing — '
      + 'zero findings is a normal and acceptable result.',
    parameters: {
      check: { type: 'string', required: true, description: 'Check id being reported, e.g. C9' },
      verdict: { type: 'string', required: true, description: 'confirmed | suspected | not-implemented' },
      file: { type: 'string', required: true, description: 'Workspace-relative path' },
      line: { type: 'number', required: true, description: '1-based line number the finding anchors to' },
      claim: { type: 'string', required: true, description: 'One sentence: what the problem is' },
      evidence: { type: 'string', required: true, description: 'The supporting code, quoted verbatim from the file' },
      consequence: { type: 'string', required: true, description: 'What breaks, and under what conditions' },
      direction: { type: 'string', description: 'What a fix looks like — a direction, not a patch' },
      confirmHint: { type: 'string', description: 'Required when verdict is suspected: what a human must verify' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const run = active.current
      if (run === undefined) {
        return 'REJECTED (no-active-run): there is no audit in progress. Do not call this tool.'
      }

      const record = (reason: RejectionReason, detail: string, remedy: string): string => {
        const r = refuse(reason, detail, remedy)
        run.rejections.push({ check: String(args.check), reason, detail })
        const outcome = run.outcomes.get(String(args.check).trim().toUpperCase())
        if (outcome !== undefined) outcome.rejectionCount += 1
        return r.text
      }

      // 1. The check must belong to this run.
      const check = String(args.check).trim().toUpperCase()
      if (!run.checkIds.has(check)) {
        return record(
          'check-not-in-run',
          `check "${args.check}" is not part of this run (running: ${[...run.checkIds].join(', ')}).`,
          'Report only the check you were assigned.',
        )
      }

      const verdict = String(args.verdict).trim().toLowerCase()
      if (!VERDICTS.includes(verdict)) {
        return record('bad-verdict', `verdict "${args.verdict}" is not one of ${VERDICTS.join(' | ')}.`, 'Resubmit with a valid verdict.')
      }

      // 5. A suspected verdict without a confirmation hint is unactionable.
      const confirmHint = args.confirmHint === undefined ? '' : String(args.confirmHint).trim()
      if (verdict === 'suspected' && confirmHint.length === 0) {
        return record(
          'missing-confirm-hint',
          'verdict is "suspected" but confirmHint is empty.',
          'State exactly what a human must check to confirm or dismiss this.',
        )
      }

      // 2. The path must be first-party code, exist, and resolve INSIDE the
      //    workspace. Resolving through ctx.fs is also what stops traversal.
      const file = String(args.file)
      const excluded = excludedBy(file, run.excludePaths)
      if (excluded !== undefined) {
        return record('out-of-scope-path', excludedMessage(file, excluded), 'Report a finding in this project\'s own source.')
      }
      let target
      try {
        target = await ctx.fs.resolve(file, { cwd: run.workspaceRoot, signal: exec.signal })
      } catch (error) {
        return record('file-not-found', `cannot resolve "${file}": ${error instanceof Error ? error.message : String(error)}.`, 'Cite a real workspace-relative path.')
      }

      const root = await ctx.fs.resolve(run.workspaceRoot, { signal: exec.signal })
      if (!ctx.fs.contains(root, target)) {
        return record('file-outside-workspace', `"${file}" resolves outside the audited workspace.`, 'Cite a path inside the workspace.')
      }

      const info = await ctx.fs.stat(target, exec.signal)
      if (info === undefined) {
        return record('file-not-found', `"${file}" does not exist.`, 'Cite a real file.')
      }

      let text: string
      try {
        text = await ctx.fs.readText(target, exec.signal)
      } catch (error) {
        return record('file-not-found', `cannot read "${file}": ${error instanceof Error ? error.message : String(error)}.`, 'Cite a readable text file.')
      }

      // 3. The line must exist.
      const line = Number(args.line)
      const lineCount = text.split(/\r?\n/u).length
      if (!Number.isSafeInteger(line) || line < 1 || line > lineCount) {
        return record('line-out-of-range', `line ${args.line} is outside "${file}" (1..${lineCount}).`, 'Cite the real line number.')
      }

      // 4. The quoted evidence must actually be there.
      const evidence = String(args.evidence)
      if (!evidenceMatches(text, line, evidence)) {
        return record(
          'evidence-not-found',
          `the quoted evidence does not appear within ${EVIDENCE_WINDOW} lines of ${file}:${line}.`,
          'Re-read the file and quote the code exactly as written, or withdraw this finding.',
        )
      }

      run.findings.push({
        check,
        verdict: verdict as Verdict,
        file,
        line,
        claim: String(args.claim),
        evidence,
        consequence: String(args.consequence),
        ...args.direction === undefined || String(args.direction).trim().length === 0
          ? {}
          : { direction: String(args.direction).trim() },
        ...confirmHint.length > 0 ? { confirmHint } : {},
      })
      const outcome = run.outcomes.get(check)
      if (outcome !== undefined) outcome.findingCount += 1

      return `recorded ${check} finding at ${file}:${line} (${verdict})`
    },
  })))
}
