/**
 * Shared run state. The two reporting tools are registered once at plugin
 * load, but they only mean anything while a run is in flight, so both resolve
 * the current run through this holder rather than closing over one.
 *
 * @module dsh-harness-audit/state
 */

import type { Check, Landmark } from './checks.ts'

export type Verdict = 'confirmed' | 'suspected' | 'not-implemented'

export interface Finding {
  check: string
  verdict: Verdict
  file: string
  line: number
  claim: string
  evidence: string
  consequence: string
  /** "what a fix looks like — not a patch", per the skill's report template. */
  direction?: string
  confirmHint?: string
}

/** Why a submitted finding was refused. Tracked per reason for run metadata. */
export type RejectionReason =
  | 'no-active-run'
  | 'unknown-check'
  | 'check-not-in-run'
  | 'bad-verdict'
  | 'file-not-found'
  | 'file-outside-workspace'
  | 'line-out-of-range'
  | 'evidence-not-found'
  | 'missing-confirm-hint'

export interface Rejection {
  check: string
  reason: RejectionReason
  detail: string
}

/** Full token usage attributed to one subagent session. */
export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
}

export function addUsage(into: Usage, from: Partial<Usage>): void {
  into.inputTokens += from.inputTokens ?? 0
  into.outputTokens += from.outputTokens ?? 0
  into.cacheReadTokens += from.cacheReadTokens ?? 0
  into.cacheWriteTokens += from.cacheWriteTokens ?? 0
  into.reasoningTokens += from.reasoningTokens ?? 0
}

/** Per-check outcome recorded whether or not the check produced findings. */
export interface CheckOutcome {
  id: string
  priority: 1 | 2
  status: 'ran' | 'skipped-missing-landmarks' | 'failed'
  /** Landmark kinds that were required but absent. */
  missingLandmarks: string[]
  /** Zero is a normal, acceptable result. */
  findingCount: number
  rejectionCount: number
  usage: Usage
  stopReason?: string
  error?: string
}

export interface RunState {
  id: string
  startedAt: number
  /** Absolute workspace root every reported path must resolve inside. */
  workspaceRoot: string
  checkIds: ReadonlySet<string>
  checks: readonly Check[]
  landmarks: Landmark[]
  findings: Finding[]
  rejections: Rejection[]
  outcomes: Map<string, CheckOutcome>
  /**
   * Usage accumulated per session id. The listener cannot filter at write
   * time — a child's session id is only known once `start()` resolves, and
   * events arrive before that — so it records every session and the totals
   * are computed over `childSessionIds` alone. Without that filter the
   * parent's own tokens would be billed to the audit.
   */
  usageBySession: Map<string, Usage>
  /** Sessions this run actually created; the filter for cost totals. */
  childSessionIds: Set<string>
  /** True once recon is done and checks may report. */
  reconComplete: boolean
  language?: string
}

/**
 * Single-slot holder. One audit at a time per plugin instance keeps
 * attribution unambiguous — a finding is attributed by its `check` id, which
 * is unique within a run.
 */
export class ActiveRun {
  #run: RunState | undefined

  get current(): RunState | undefined {
    return this.#run
  }

  begin(run: RunState): void {
    if (this.#run !== undefined) throw new Error('an audit is already in progress')
    this.#run = run
  }

  end(): void {
    this.#run = undefined
  }
}
