/**
 * The dimension table: ids, priorities, and landmark dependencies only.
 *
 * There is deliberately NO criteria prose here. What each check MEANS lives
 * in `./criteria.ts`, which is what a subagent is actually judged against.
 * The `name` and `group` strings below are routing labels for the report's
 * headings — a subagent is shown neither, and neither may stand in for the
 * criteria.
 *
 * @module dsh-harness-audit/checks
 */

/** Landmark kinds the recon pass can report. */
export type LandmarkKind =
  | 'agent-loop'
  | 'request-assembly'
  | 'system-prompt-build'
  | 'tool-registry'
  | 'tool-execution'
  | 'history-append'
  | 'stream-parse'
  | 'retry'
  | 'truncation'
  | 'process-spawn'
  | 'http-call'

export const LANDMARK_KINDS: readonly LandmarkKind[] = [
  'agent-loop',
  'request-assembly',
  'system-prompt-build',
  'tool-registry',
  'tool-execution',
  'history-append',
  'stream-parse',
  'retry',
  'truncation',
  'process-spawn',
  'http-call',
]

export interface Landmark {
  kind: LandmarkKind
  /** Workspace-relative path. */
  file: string
  line: number
  symbol?: string
  confidence: 'high' | 'low'
}

export interface Check {
  id: string
  priority: 1 | 2
  /**
   * Landmarks the check cannot run without. Missing ANY of these short-circuits
   * the check to `not-implemented` without spending a subagent — running a
   * check with no target is a leading source of false positives.
   */
  requires: readonly LandmarkKind[]
  /**
   * Additional landmarks handed to the subagent when present. Absence never
   * short-circuits. This split exists because a strict AND over every
   * plausibly-related landmark would skip checks that are perfectly runnable
   * from their primary anchor alone.
   */
  context: readonly LandmarkKind[]
  /**
   * The check's name and group, used so the report can render
   * `### C<n> · <check name>` and the per-group Summary the template asks for.
   * These are LABELS, never criteria — a subagent is shown neither.
   */
  name: string
  group: string
}

/** Group headings, in criteria order. */
export const GROUPS: readonly string[] = [
  'State stays self-consistent',
  'Untrusted input is treated as untrusted',
  'Failure is a first-class outcome',
  'Boundaries can be closed',
  'Finite resources are accounted for',
  'The run is observable',
]

export const CHECKS: readonly Check[] = [
  { id: 'C1', priority: 1, requires: ['tool-execution'], context: ['history-append', 'agent-loop'], name: 'Tool-call pairing completeness', group: GROUPS[0] },
  { id: 'C2', priority: 2, requires: ['history-append'], context: ['truncation'], name: 'History is append-only', group: GROUPS[0] },
  { id: 'C3', priority: 2, requires: ['history-append'], context: ['agent-loop'], name: 'Crash and checkpoint semantics', group: GROUPS[0] },
  { id: 'C4', priority: 1, requires: ['stream-parse'], context: ['retry'], name: 'Model output parsing', group: GROUPS[1] },
  { id: 'C5', priority: 2, requires: ['tool-execution'], context: ['process-spawn'], name: 'Path and sandbox boundaries', group: GROUPS[1] },
  { id: 'C6', priority: 2, requires: ['process-spawn'], context: ['tool-execution'], name: 'Secrets and ambient environment', group: GROUPS[1] },
  { id: 'C7', priority: 2, requires: ['tool-execution'], context: ['retry', 'http-call'], name: 'Error taxonomy and retryability', group: GROUPS[2] },
  { id: 'C8', priority: 2, requires: ['tool-execution'], context: [], name: 'Partial success', group: GROUPS[2] },
  { id: 'C9', priority: 1, requires: ['retry'], context: ['tool-execution', 'http-call'], name: 'Idempotency and side-effect safety', group: GROUPS[2] },
  { id: 'C10', priority: 1, requires: ['agent-loop'], context: ['process-spawn', 'http-call', 'tool-execution'], name: 'Cancellation propagation', group: GROUPS[3] },
  { id: 'C11', priority: 2, requires: ['tool-execution'], context: ['http-call', 'process-spawn'], name: 'Timeout layering', group: GROUPS[3] },
  { id: 'C12', priority: 1, requires: ['agent-loop'], context: [], name: 'Loop and budget limits', group: GROUPS[3] },
  { id: 'C13', priority: 1, requires: ['truncation'], context: ['history-append', 'request-assembly'], name: 'Context management and truncation boundaries', group: GROUPS[4] },
  { id: 'C14', priority: 1, requires: ['request-assembly'], context: ['system-prompt-build'], name: 'Prompt prefix determinism', group: GROUPS[4] },
  { id: 'C15', priority: 2, requires: ['history-append'], context: ['agent-loop'], name: 'Trace completeness and replay', group: GROUPS[5] },
]

export const CHECK_BY_ID: ReadonlyMap<string, Check> = new Map(CHECKS.map((c) => [c.id, c]))

/**
 * Resolve the run's check list from configuration. Unknown ids are returned
 * separately so the caller can fail loudly rather than silently auditing less
 * than the user asked for.
 */
export function selectChecks(
  requested: readonly string[],
  priorityFloor: number,
): { selected: Check[]; unknown: string[] } {
  if (requested.length === 0) {
    return { selected: CHECKS.filter((c) => c.priority <= priorityFloor), unknown: [] }
  }
  const selected: Check[] = []
  const unknown: string[] = []
  for (const raw of requested) {
    const id = raw.trim().toUpperCase()
    const check = CHECK_BY_ID.get(id)
    if (check === undefined) {
      unknown.push(raw)
      continue
    }
    // An explicit id is an explicit request: the priority floor filters the
    // default set, it does not veto a check the user named.
    if (!selected.includes(check)) selected.push(check)
  }
  return { selected, unknown }
}
