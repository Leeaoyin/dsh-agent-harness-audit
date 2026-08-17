/**
 * Recon: `report_landmark` plus the prompt for the single reconnaissance
 * subagent.
 *
 * Recon exists so the fan-out has targets. A check dispatched with no landmark
 * lets the subagent roam, and roaming is where false positives come from —
 * hence the hard short-circuit in the orchestrator rather than a best-effort
 * run.
 *
 * @module dsh-harness-audit/recon
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only side-effect import: loads the `ctx.fs` augmentation of Context.
import type {} from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { LANDMARK_KINDS, type LandmarkKind } from './checks.ts'
import { LANDMARK_GUIDE } from './criteria.ts'
import { CAPABILITY_PREAMBLE, scopePreamble } from './prompt.ts'
import { excludedBy, excludedMessage } from './scope.ts'
import type { ActiveRun } from './state.ts'

export function registerReportLandmark(ctx: Context, active: ActiveRun): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'report_landmark',
    description:
      'Report one located landmark in the audited codebase. Call once per landmark. '
      + 'Not finding a given kind is a normal result — skip it rather than inventing one.',
    parameters: {
      kind: { type: 'string', required: true, description: `One of: ${LANDMARK_KINDS.join(', ')}` },
      file: { type: 'string', required: true, description: 'Workspace-relative path' },
      line: { type: 'number', required: true, description: '1-based line number' },
      symbol: { type: 'string', description: 'Enclosing function or class name, when there is one' },
      confidence: { type: 'string', required: true, description: 'high | low' },
      language: { type: 'string', description: "The project's primary language; supply it on your first call" },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const run = active.current
      if (run === undefined) return 'REJECTED: there is no audit in progress. Do not call this tool.'
      if (run.reconComplete) return 'REJECTED: reconnaissance for this run is already closed.'

      const kind = String(args.kind).trim() as LandmarkKind
      if (!LANDMARK_KINDS.includes(kind)) {
        return `REJECTED: "${args.kind}" is not a landmark kind. Use one of: ${LANDMARK_KINDS.join(', ')}.`
      }

      const confidence = String(args.confidence).trim().toLowerCase()
      if (confidence !== 'high' && confidence !== 'low') {
        return `REJECTED: confidence must be "high" or "low", got "${args.confidence}".`
      }

      const file = String(args.file)
      const excluded = excludedBy(file, run.excludePaths)
      if (excluded !== undefined) return `REJECTED: ${excludedMessage(file, excluded)}`

      let target
      try {
        target = await ctx.fs.resolve(file, { cwd: run.workspaceRoot, signal: exec.signal })
      } catch (error) {
        return `REJECTED: cannot resolve "${file}": ${error instanceof Error ? error.message : String(error)}.`
      }

      const root = await ctx.fs.resolve(run.workspaceRoot, { signal: exec.signal })
      if (!ctx.fs.contains(root, target)) return `REJECTED: "${file}" resolves outside the audited workspace.`

      const info = await ctx.fs.stat(target, exec.signal)
      if (info === undefined) return `REJECTED: "${file}" does not exist.`

      const text = await ctx.fs.readText(target, exec.signal)
      const lineCount = text.split(/\r?\n/u).length
      const line = Number(args.line)
      if (!Number.isSafeInteger(line) || line < 1 || line > lineCount) {
        return `REJECTED: line ${args.line} is outside "${file}" (1..${lineCount}).`
      }

      const language = args.language === undefined ? '' : String(args.language).trim()
      if (language.length > 0 && run.language === undefined) run.language = language

      run.landmarks.push({
        kind,
        file,
        line,
        ...args.symbol === undefined ? {} : { symbol: String(args.symbol) },
        confidence,
      })
      return `recorded ${kind} landmark at ${file}:${line}`
    },
  })))
}

/** Prompt for the reconnaissance subagent. */
export function reconPrompt(excludes: readonly string[], outputLanguage?: string): string {
  return [
    'Locate the landmarks described below. Do this and nothing else.',
    '',
    LANDMARK_GUIDE,
    '',
    CAPABILITY_PREAMBLE,
    '',
    scopePreamble(excludes),
    ...outputLanguage === undefined ? [] : ['', outputLanguage],
    '',
    'Report every landmark you locate through `report_landmark`, once per landmark. On the',
    'first one, also pass `language` with the primary implementation language of the project',
    'under audit.',
    '',
    'Not finding a given kind of landmark is a normal result — skip it. Do not invent one,',
    'and do not report a location you have not actually opened and read.',
    '',
    'Do NOT execute any of the check items. Do not report findings. Stop when the landmarks',
    'are reported.',
  ].join('\n')
}
