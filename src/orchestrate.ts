/**
 * Run orchestration: recon, fan-out, and deterministic summarisation.
 *
 * Stage C is pure code on purpose. Handing the finished findings back to a
 * model for a "summary" is how `suspected` silently becomes `confirmed` and
 * how claims with no evidence behind them enter the report. The criteria warn
 * about exactly that, and the plugin must not undo it at the implementation
 * layer.
 *
 * @module dsh-harness-audit/orchestrate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only side-effect imports: load the `ctx.fs` / `ctx.subagents`
// augmentations of Context.
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subagent'
import { selectChecks, type Check, type LandmarkKind } from './checks.ts'
import type { Config } from './config.ts'
import type { Messages } from './i18n.ts'
import { CHECK_CRITERIA, EVIDENCE_RULES } from './criteria.ts'
import { CAPABILITY_PREAMBLE, scopePreamble } from './prompt.ts'
import { reconPrompt } from './recon.ts'
import {
  ActiveRun,
  addUsage,
  emptyUsage,
  type CheckOutcome,
  type Finding,
  type RunState,
  type Usage,
} from './state.ts'

/**
 * Audit children inherit the parent's tools rather than being scoped to an
 * allow-list.
 *
 * An earlier version passed `toolFilter: { allow: [...] }` to narrow each
 * child, and it broke the plugin completely. The allow-list has to be built
 * from names the CHILD's scope will recognise, but a plugin can only see its
 * own scope: `ctx.tools.get('read')` returns undefined here because
 * model-facing tools live on the agent plane, not the global layer this
 * plugin registers into. The list therefore collapsed to just
 * `report_finding`, and `tools.restrict()` removed everything else — recon
 * subagents came back with `unknown tool "read"`, `unknown tool "glob"`,
 * and even `unknown tool "report_landmark"`, so no audit could produce
 * anything.
 *
 * There is no supported way to enumerate the child's scope before it exists,
 * and `tools.restrict()` throws on a name that scope does not know, so
 * guessing is worse than not scoping. Tool scoping was a cost optimisation,
 * not a correctness requirement; the run-id gate in `report_finding` already
 * covers the visibility concern it was meant to address.
 */

export interface RunMeta {
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  workspaceRoot: string
  commit?: string
  language?: string
  subagentProvider: string
  concurrency: number
  /**
   * Advisory only. The subagent seam has no whole-run token cap
   * (`AgentOptions.maxTokens` bounds one response), so this is stated to the
   * child and recorded here; the observed cost below is the real figure.
   */
  maxTokensPerCheckAdvisory: number
  requestedChecks: string[]
  ranChecks: string[]
  skippedChecks: string[]
  unknownChecks: string[]
  /** Recon's own cost, which belongs to no single check. */
  reconUsage: Usage
  /** Recon plus every check. */
  totalUsage: Usage
  /** The plugin's most important quality signal. */
  evidenceRejections: number
  rejectionsByReason: Record<string, number>
  findingCount: number
  landmarkCount: number
  /** Directory names refused as out of scope for this run. */
  excludePaths: string[]
  lspAvailable: boolean | 'not-probed'
}

export interface AuditResult {
  meta: RunMeta
  run: RunState
  findings: Finding[]
  outcomes: CheckOutcome[]
}

function conservatismRank(verdict: string): number {
  // Promotion needs evidence, demotion does not — so the least certain
  // verdict survives a duplicate.
  if (verdict === 'suspected') return 0
  if (verdict === 'not-implemented') return 1
  return 2
}

function checkOrder(id: string): number {
  const n = Number.parseInt(id.replace(/^C/iu, ''), 10)
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n
}

/** Deduplicate on check+file+line, keeping the most conservative verdict. */
export function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const byKey = new Map<string, Finding>()
  for (const finding of findings) {
    const key = `${finding.check}\u0000${finding.file}\u0000${finding.line}`
    const existing = byKey.get(key)
    if (existing === undefined || conservatismRank(finding.verdict) < conservatismRank(existing.verdict)) {
      byKey.set(key, finding)
    }
  }
  return [...byKey.values()]
}

/** Run at most `limit` tasks concurrently. `limit: 1` is a supported path. */
async function pool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const size = Math.max(1, Math.min(limit, queue.length))
  const workers = Array.from({ length: size }, async () => {
    for (;;) {
      const next = queue.shift()
      if (next === undefined) return
      await task(next)
    }
  })
  await Promise.all(workers)
}

export function checkPrompt(
  check: Check,
  landmarks: RunState['landmarks'],
  language: string | undefined,
  budget: number,
  excludes: readonly string[] = [],
  outputLanguage?: string,
): string {
  const relevant = landmarks.filter((l) => check.requires.includes(l.kind) || check.context.includes(l.kind))
  const lines = relevant.map((l) => `- ${l.kind}: ${l.file}:${l.line}${l.symbol === undefined ? '' : ` (${l.symbol})`} [confidence: ${l.confidence}]`)
  // Only this check's criteria are sent. One check per subagent means the
  // prompt never carries the other fourteen, which is both cheaper and the
  // reason a finding cannot drift into a neighbouring check's territory.
  const criteria = CHECK_CRITERIA[check.id]
  return [
    `Audit this codebase against check **${check.id} · ${check.name}**, and nothing else.`,
    '',
    'The criteria, in full:',
    '',
    criteria ?? '(no criteria are defined for this check — report nothing and say so)',
    '',
    'Relevant landmarks:',
    ...lines.length > 0 ? lines : ['- (none reported)'],
    '',
    `Primary project language: ${language ?? 'unknown'}.`,
    `Stay within roughly ${budget} tokens of work.`,
    '',
    CAPABILITY_PREAMBLE,
    '',
    scopePreamble(excludes),
    '',
    EVIDENCE_RULES,
    '',
    'Report each finding through `report_finding`, once per finding. Include `direction`:',
    'what a fix looks like, as a direction rather than a patch.',
    'If you find nothing, do not call it at all — just finish. **Zero findings is a normal and',
    'acceptable result.**',
    ...outputLanguage === undefined ? [] : ['', outputLanguage],
    '',
    'The `evidence` you quote is checked against the file at the line you cite; a submission whose',
    'evidence is not actually there will be rejected.',
  ].join('\n')
}

/**
 * Read HEAD's commit by following the ref through `.git`, rather than
 * spawning git. Any failure (no repo, a worktree's `.git` file, a packed
 * ref) just omits the field — the commit is report metadata, not a
 * precondition for auditing.
 */
async function readCommit(ctx: Context, root: string, signal?: AbortSignal): Promise<string | undefined> {
  // `exactOptionalPropertyTypes` rejects an explicit `signal: undefined`, so
  // the key is omitted rather than passed empty.
  const opts = { cwd: root, ...signal === undefined ? {} : { signal } }
  try {
    const headTarget = await ctx.fs.resolve('.git/HEAD', opts)
    if (await ctx.fs.stat(headTarget, signal) === undefined) return undefined
    const head = (await ctx.fs.readText(headTarget, signal)).trim()
    if (!head.startsWith('ref: ')) return /^[0-9a-f]{7,40}$/iu.test(head) ? head : undefined
    const refTarget = await ctx.fs.resolve(`.git/${head.slice(5).trim()}`, opts)
    if (await ctx.fs.stat(refTarget, signal) === undefined) return undefined
    const sha = (await ctx.fs.readText(refTarget, signal)).trim()
    return /^[0-9a-f]{7,40}$/iu.test(sha) ? sha : undefined
  } catch {
    return undefined
  }
}

async function probeLsp(ctx: Context, run: RunState): Promise<boolean | 'not-probed'> {
  const anchor = run.landmarks.find((l) => l.confidence === 'high') ?? run.landmarks[0]
  if (anchor === undefined) return 'not-probed'
  const lsp = ctx.get('lsp')
  if (lsp === undefined) return false
  try {
    await lsp.query({
      operation: 'hover',
      filePath: anchor.file,
      position: { line: Math.max(0, anchor.line - 1), character: 0 },
      workspaceRoot: run.workspaceRoot,
    })
    return true
  } catch {
    // Availability is only observable by running a query and routing on the
    // thrown LspError — there is no capability query on this seam. Selection
    // is per file EXTENSION, so this probe speaks only for the audited
    // language, which is why it runs after recon rather than at load.
    return false
  }
}

export async function runAudit(
  ctx: Context,
  config: Config,
  active: ActiveRun,
  options: {
    agent: Agent
    signal: AbortSignal
    requestedChecks: readonly string[]
    /** Progress line sink. A blocking command has nowhere to put these; a job does. */
    onProgress?: (line: string) => void
    /** Message table for progress lines. */
    messages: Messages
  },
): Promise<AuditResult> {
  const { agent, signal } = options
  const progress = options.onProgress ?? ((): void => {})
  const m = options.messages
  const requested = options.requestedChecks.length > 0 ? options.requestedChecks : config.checks
  const { selected, unknown } = selectChecks(requested, config.priorityFloor)
  if (selected.length === 0) {
    throw new Error(
      unknown.length > 0
        ? `no known checks selected; unrecognised: ${unknown.join(', ')}`
        : 'no checks selected by the current configuration',
    )
  }

  const workspaceRoot = agent.session.header.cwd ?? process.cwd()
  const startedAt = Date.now()
  const run: RunState = {
    id: `audit-${startedAt.toString(36)}`,
    startedAt,
    workspaceRoot,
    checkIds: new Set(selected.map((c) => c.id)),
    checks: selected,
    landmarks: [],
    findings: [],
    rejections: [],
    outcomes: new Map(selected.map((c) => [c.id, {
      id: c.id,
      priority: c.priority,
      status: 'ran',
      missingLandmarks: [],
      findingCount: 0,
      rejectionCount: 0,
      usage: emptyUsage(),
    } satisfies CheckOutcome])),
    usageBySession: new Map(),
    childSessionIds: new Set(),
    excludePaths: config.excludePaths,
    reconComplete: false,
  }

  active.begin(run)

  // Full TokenUsage rides on `assistant/message`; the subagent seam's result
  // does not carry usage, so cost is folded from the session event stream.
  let disposeUsage: (() => void) | undefined

  try {
    disposeUsage = ctx.on('session/event', (session, event) => {
      if (event.type !== 'assistant/message') return
      const usage = (event.data as { usage?: Partial<Usage> }).usage
      if (usage === undefined) return
      const existing = run.usageBySession.get(session.id) ?? emptyUsage()
      addUsage(existing, usage)
      run.usageBySession.set(session.id, existing)
    })

    const commit = await readCommit(ctx, workspaceRoot, signal)

    const provider = ctx.subagents.getProvider(config.subagentProvider)
    if (provider === undefined) {
      throw new Error(`subagent provider "${config.subagentProvider}" is not registered`)
    }
    const startChild = async (prompt: string, label: string): Promise<{ sessionId: string | undefined; stopReason: string }> => {
      const child = await ctx.subagents.start(config.subagentProvider, {
        label,
        prompt: [{ type: 'text', text: prompt }],
        parent: agent,
        signal,
        // No toolFilter — see the note at the top of this module.
      })
      run.childSessionIds.add(child.id)
      try {
        const result = await child.result
        return { sessionId: child.id, stopReason: result.stopReason }
      } finally {
        await child.dispose()
      }
    }

    // ---- A. Recon -------------------------------------------------------
    progress(m.locating(selected.length, selected.map((c) => c.id).join(', ')))
    const recon = await startChild(reconPrompt(config.excludePaths, m.outputLanguage), 'harness-audit recon')
    run.reconComplete = true

    const kindCounts = new Map<string, number>()
    for (const l of run.landmarks) kindCounts.set(l.kind, (kindCounts.get(l.kind) ?? 0) + 1)
    progress(m.reconDone(run.landmarks.length, kindCounts.size, run.language ?? 'undetermined'))

    const lspAvailable = config.useLsp ? await probeLsp(ctx, run) : 'not-probed'
    const presentKinds = new Set<LandmarkKind>(run.landmarks.map((l) => l.kind))

    // ---- B. Fan-out -----------------------------------------------------
    const runnable: Check[] = []
    for (const check of selected) {
      const missing = check.requires.filter((kind) => !presentKinds.has(kind))
      const outcome = run.outcomes.get(check.id)
      if (missing.length > 0) {
        if (outcome !== undefined) {
          outcome.status = 'skipped-missing-landmarks'
          outcome.missingLandmarks = missing
        }
        progress(m.notCovered(check.id, missing.join(', ')))
        continue
      }
      runnable.push(check)
    }

    await pool(runnable, config.concurrency, async (check) => {
      const outcome = run.outcomes.get(check.id)
      progress(m.checkRunning(check.id, check.name))
      try {
        const child = await startChild(
          checkPrompt(check, run.landmarks, run.language, config.maxTokensPerCheck, config.excludePaths, m.outputLanguage),
          `harness-audit ${check.id}`,
        )
        if (outcome !== undefined) {
          outcome.stopReason = child.stopReason
          if (child.sessionId !== undefined) {
            const usage = run.usageBySession.get(child.sessionId)
            // Copy: the map entry stays live for any late-arriving event.
            if (usage !== undefined) outcome.usage = { ...usage }
          }
          progress(m.checkDone(check.id, outcome.findingCount, outcome.rejectionCount, outcome.usage.inputTokens, outcome.usage.outputTokens))
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        if (outcome !== undefined) {
          outcome.status = 'failed'
          outcome.error = detail
        }
        progress(m.checkFailed(check.id, detail))
      }
    })

    // ---- C. Summarise (pure code) ---------------------------------------
    const findings = dedupeFindings(run.findings).sort((a, b) => {
      const pa = run.outcomes.get(a.check)?.priority ?? 9
      const pb = run.outcomes.get(b.check)?.priority ?? 9
      if (pa !== pb) return pa - pb
      const ca = checkOrder(a.check)
      const cb = checkOrder(b.check)
      if (ca !== cb) return ca - cb
      const va = conservatismRank(a.verdict)
      const vb = conservatismRank(b.verdict)
      if (va !== vb) return vb - va
      return a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)
    })

    // Only this run's own children: the listener sees every session on the
    // context, and the parent's tokens are not the audit's cost.
    const totalUsage = emptyUsage()
    for (const sessionId of run.childSessionIds) {
      const usage = run.usageBySession.get(sessionId)
      if (usage !== undefined) addUsage(totalUsage, usage)
    }

    const rejectionsByReason: Record<string, number> = {}
    for (const rejection of run.rejections) {
      rejectionsByReason[rejection.reason] = (rejectionsByReason[rejection.reason] ?? 0) + 1
    }

    const outcomes = [...run.outcomes.values()].sort((a, b) => checkOrder(a.id) - checkOrder(b.id))
    const finishedAt = Date.now()

    const meta: RunMeta = {
      runId: run.id,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      workspaceRoot,
      ...commit === undefined ? {} : { commit },
      ...run.language === undefined ? {} : { language: run.language },
      subagentProvider: config.subagentProvider,
      concurrency: config.concurrency,
      maxTokensPerCheckAdvisory: config.maxTokensPerCheck,
      requestedChecks: [...requested],
      ranChecks: outcomes.filter((o) => o.status === 'ran').map((o) => o.id),
      skippedChecks: outcomes.filter((o) => o.status !== 'ran').map((o) => o.id),
      unknownChecks: unknown,
      reconUsage: recon.sessionId === undefined
        ? emptyUsage()
        : { ...run.usageBySession.get(recon.sessionId) ?? emptyUsage() },
      totalUsage,
      evidenceRejections: run.rejections.length,
      rejectionsByReason,
      findingCount: findings.length,
      landmarkCount: run.landmarks.length,
      excludePaths: [...config.excludePaths],
      lspAvailable,
    }

    return { meta, run, findings, outcomes }
  } finally {
    disposeUsage?.()
    active.end()
  }
}
