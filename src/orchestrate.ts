/**
 * Run orchestration: recon, fan-out, and deterministic summarisation.
 *
 * Stage C is pure code on purpose. Handing the finished findings back to a
 * model for a "summary" is how `suspected` silently becomes `confirmed` and
 * how claims with no evidence behind them enter the report. The skill warns
 * about exactly that, and the plugin must not undo it at the implementation
 * layer.
 *
 * @module dsh-harness-audit/orchestrate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { selectChecks, type Check, type LandmarkKind } from './checks.ts'
import type { Config } from './config.ts'
import { reconPrompt } from './recon.ts'
import { resolveSkillOrigin, type SkillOrigin } from './skill.ts'
import {
  ActiveRun,
  addUsage,
  emptyUsage,
  type CheckOutcome,
  type Finding,
  type RunState,
  type Usage,
} from './state.ts'

/** Tools an audit child may use, before filtering to what is registered. */
const AUDIT_CHILD_TOOLS = ['skill', 'read', 'grep', 'glob', 'report_finding']

export interface RunMeta {
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  workspaceRoot: string
  commit?: string
  language?: string
  skill: SkillOrigin
  skillName: string
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

function checkPrompt(
  check: Check,
  skillName: string,
  landmarks: RunState['landmarks'],
  language: string | undefined,
  budget: number,
): string {
  const relevant = landmarks.filter((l) => check.requires.includes(l.kind) || check.context.includes(l.kind))
  const lines = relevant.map((l) => `- ${l.kind}: ${l.file}:${l.line}${l.symbol === undefined ? '' : ` (${l.symbol})`} [confidence: ${l.confidence}]`)
  return [
    `Load the skill \`${skillName}\`. Execute ONLY check item **${check.id}**.`,
    'Ignore every other check item, and ignore PART 2 and PART 3 entirely.',
    '',
    'Relevant landmarks:',
    ...lines.length > 0 ? lines : ['- (none reported)'],
    '',
    `Primary project language: ${language ?? 'unknown'}. Use that language's search cues from the skill.`,
    `Stay within roughly ${budget} tokens of work.`,
    '',
    'Call `report_finding` once per finding. Include `direction`: what a fix looks like,',
    'as a direction rather than a patch.',
    'If you find nothing, do not call it at all — just finish. **Zero findings is a normal and',
    'acceptable result.**',
    '',
    'Follow the skill\'s "Evidence rules": do not report a finding without a file and line number.',
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
  try {
    const headTarget = await ctx.fs.resolve('.git/HEAD', { cwd: root, signal })
    if (await ctx.fs.stat(headTarget, signal) === undefined) return undefined
    const head = (await ctx.fs.readText(headTarget, signal)).trim()
    if (!head.startsWith('ref: ')) return /^[0-9a-f]{7,40}$/iu.test(head) ? head : undefined
    const refTarget = await ctx.fs.resolve(`.git/${head.slice(5).trim()}`, { cwd: root, signal })
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
  options: { agent: Agent; signal: AbortSignal; requestedChecks: readonly string[] },
): Promise<AuditResult> {
  const { agent, signal } = options
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

    const skill = await resolveSkillOrigin(ctx, config.skillName, { cwd: workspaceRoot, signal })
    const commit = await readCommit(ctx, workspaceRoot, signal)

    const provider = ctx.subagents.getProvider(config.subagentProvider)
    if (provider === undefined) {
      throw new Error(`subagent provider "${config.subagentProvider}" is not registered`)
    }
    const canFilterTools = provider.capabilities?.toolFilter === true

    // Filtering to registered names matters: tools.restrict() throws on an
    // unknown name, which would fail the start outright.
    const allow = [...AUDIT_CHILD_TOOLS, ...config.useLsp ? ['lsp'] : []]
      .filter((name) => ctx.tools.get(name) !== undefined)

    const startChild = async (prompt: string, label: string): Promise<{ sessionId: string | undefined; stopReason: string }> => {
      const child = await ctx.subagents.start(config.subagentProvider, {
        label,
        prompt: [{ type: 'text', text: prompt }],
        parent: agent,
        signal,
        ...canFilterTools && allow.length > 0 ? { toolFilter: { allow } } : {},
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
    const recon = await startChild(reconPrompt(config.skillName), 'harness-audit recon')
    run.reconComplete = true

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
        continue
      }
      runnable.push(check)
    }

    await pool(runnable, config.concurrency, async (check) => {
      const outcome = run.outcomes.get(check.id)
      try {
        const child = await startChild(
          checkPrompt(check, config.skillName, run.landmarks, run.language, config.maxTokensPerCheck),
          `harness-audit ${check.id}`,
        )
        if (outcome !== undefined) {
          outcome.stopReason = child.stopReason
          if (child.sessionId !== undefined) {
            const usage = run.usageBySession.get(child.sessionId)
            // Copy: the map entry stays live for any late-arriving event.
            if (usage !== undefined) outcome.usage = { ...usage }
          }
        }
      } catch (error) {
        if (outcome !== undefined) {
          outcome.status = 'failed'
          outcome.error = error instanceof Error ? error.message : String(error)
        }
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
      skill,
      skillName: config.skillName,
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
      lspAvailable,
    }

    return { meta, run, findings, outcomes }
  } finally {
    disposeUsage?.()
    active.end()
  }
}
