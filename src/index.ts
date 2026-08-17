/**
 * dsh-harness-audit — audits an agent harness for the failure modes that
 * break agent loops.
 *
 * The criteria live in `./criteria.ts`; everything else here is machinery —
 * the command entry point, orchestration, evidence validation, and
 * deterministic summarisation. The plugin is self-contained: installing it
 * installs the criteria too.
 *
 * @module dsh-harness-audit
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only side-effect import: loads the `ctx.commands` augmentation.
import type {} from '@deepseek-ai/dsh-commands'
// Loads the `ctx.jobs` augmentation; the service is optional and read through
// `ctx.get`, so this is a type-only dependency.
import type { JobOutcome, JobStart } from '@deepseek-ai/dsh-jobs'
// Loads the `ctx.sandboxPolicy` augmentation; the service itself is optional
// and read through `ctx.get`.
import type {} from '@deepseek-ai/dsh-sandbox-policy'
// Runtime import: the notice needs a properly identified, frozen user message.
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { parseAuditArgs } from './args.ts'
import { CHECKS, selectChecks } from './checks.ts'
import { messages, resolveLanguage } from './i18n.ts'
import { Config } from './config.ts'
import { registerReportFinding } from './findings.ts'
import { runAudit } from './orchestrate.ts'
import { pickDimensions } from './picker.ts'
import { registerReportLandmark } from './recon.ts'
import { writeReports } from './render.ts'
import { ActiveRun } from './state.ts'

export { Config } from './config.ts'
export { CHECKS } from './checks.ts'

export const name = 'harness-audit'

/**
 * Cap on a `form: 'notice'` summary, mirroring the seam's
 * `CONTEXT_SUMMARY_MAX_CHARS`. Duplicated as a number rather than imported so
 * a localised summary cannot exceed it by accident.
 */
const SUMMARY_MAX = 120

export const inject = ['commands', 'subagents', 'tools', 'fs']

export function apply(ctx: Context, config: Config): void {
  const active = new ActiveRun()
  registerReportLandmark(ctx, active)
  registerReportFinding(ctx, active)

  ctx.effect(() => ctx.commands.register({
    name: 'harness-audit',
    description: "Audit this workspace's agent harness for the failure modes that break agent loops.",
    input: { hint: '[C1 | C1,C9 | p1 | all]' },
    async handler(invocation) {
      // Resolved per invocation, not at load: the locale can change while the
      // plugin stays mounted.
      const m = messages(resolveLanguage(ctx, config.language))
      if (active.current !== undefined) {
        return { kind: 'error', text: m.alreadyRunning }
      }

      const args = parseAuditArgs(invocation.rawInput)
      if (args.kind === 'unparsed') {
        return { kind: 'error', text: m.badInput(args.raw) }
      }

      // Resolve the dimensions up front so the immediate result can name them.
      // Doing it here also surfaces a typo'd id straight away instead of
      // failing later inside a job the user has to go read.
      let requestedChecks: string[] = []
      let floor = config.priorityFloor
      if (args.kind === 'checks') {
        requestedChecks = args.checks
      } else if (args.kind === 'preset') {
        floor = args.preset === 'p1' ? 1 : 2
      } else {
        // No arguments: ask, rather than requiring the flag and the id table
        // to be known in advance.
        const picked = await pickDimensions(ctx, m, invocation.agent, invocation.signal)
        if (picked.kind === 'picked') {
          requestedChecks = picked.checks
        } else if (picked.kind === 'dismissed') {
          // Closing the prompt is a cancel, not consent to audit everything.
          // With no configured `checks`, the alternative would be launching
          // all fifteen dimensions on a dismissed dialog.
          return { kind: 'success', text: m.pickCancelled }
        } else {
          // No question UI (headless, ACP): configuration decides, so the
          // command still works without a human to ask.
          requestedChecks = config.checks
        }
      }

      const { selected, unknown } = selectChecks(requestedChecks, floor)
      if (unknown.length > 0) {
        return { kind: 'error', text: m.unknownChecks(unknown.join(', '), CHECKS.map((c) => c.id).join(', ')) }
      }
      if (selected.length === 0) {
        return { kind: 'error', text: m.noChecksSelected }
      }
      const dimensions = selected.map((c) => `${c.id} (${c.name})`).join(', ')
      // Resolve the session's effective sandbox policy so the report write runs
      // under the mode the user chose. Optional service: without it the backend
      // default applies, which is what refused the write before.
      const policy = ctx.get('sandboxPolicy')?.resolve({ session: invocation.agent.session })

      // Captured from the finished run so the job's terminal row can show it.
      let lastDetail: string | undefined

      const execute = async (
        signal: AbortSignal,
        onProgress: (line: string) => void,
      ): Promise<string> => {
        const result = await runAudit(ctx, config, active, {
          agent: invocation.agent,
          signal,
          requestedChecks,
          onProgress,
          messages: m,
        })
        const paths = await writeReports(ctx, result, config.outputDir, m, signal, policy)
        const { meta } = result
        lastDetail = m.jobDetail(meta.findingCount, meta.evidenceRejections, meta.totalUsage.inputTokens, meta.totalUsage.outputTokens)
        return m.complete({
          findings: meta.findingCount,
          checks: meta.ranChecks.length,
          skipped: meta.skippedChecks.join(', '),
          rejections: meta.evidenceRejections,
          input: meta.totalUsage.inputTokens,
          output: meta.totalUsage.outputTokens,
          md: paths.markdown,
          json: paths.json,
        })
      }

      const jobs = config.background ? ctx.get('jobs') : undefined
      if (jobs !== undefined) {
        const pending: string[] = []
        const id = jobs.start({
          // The job kind is also the id prefix. `JobKind` is a merge-extensible
          // union whose map is declared in the jobs package's internal types
          // module, which the published package exposes through no subpath, so
          // there is nothing to augment. The registry validates only that the
          // kind is a non-empty string.
          kind: 'harness-audit' as unknown as JobStart['kind'],
          // The jobs UI row renders kind + label + status + a live elapsed
          // clock, independently of any turn. While running, this label is
          // the only producer text it can show, so it carries the dimensions.
          label: m.jobLabel(selected.map((c) => c.id).join(', '), selected[0].name, selected.length),
          owner: invocation.agent,
          run: () => {
            const controller = new AbortController()
            const done = execute(controller.signal, (line) => pending.push(line)).then(
              (summary): JobOutcome => {
                pending.push(summary)
                // Terminal detail replaces the generic status word on the
                // finished row, so the result is legible without opening
                // the report or asking the model for job output.
                return { status: 'completed', detail: lastDetail ?? '' }
              },
              (error: unknown): JobOutcome => {
                const detail = error instanceof Error ? error.message : String(error)
                pending.push(m.failed(detail))
                // A cancelled run reports `killed`, not `failed`: the
                // distinction is what tells a reader whether to investigate.
                return controller.signal.aborted
                  ? { status: 'killed', detail: 'cancelled' }
                  : { status: 'failed', detail }
              },
            )
            return {
              cancel: (reason?: string) => { controller.abort(reason ?? 'harness audit cancelled') },
              done,
              readOutput: () => (pending.length === 0 ? '' : `${pending.splice(0).join('\n')}\n`),
            }
          },
        })
        // A command produces no turn, and every conversation slot that could
        // show the running job is `scope: 'session'` — gated on an existing
        // session — so in a NEW conversation the command looks inert. `steer`
        // starts a turn on an idle driver (`dsh-plan-mode` uses the same call
        // for the same reason); once a turn exists the session-scoped
        // surfaces render. Deliberately NOT `source: { kind: 'user' }`: this
        // text is the plugin's, and attributing it to the human would put
        // words in their mouth in the durable transcript.
        if (config.announceOnStart) {
          invocation.agent.steer(createUserMessage({
            content: [{ type: 'text', text: m.announce(id, dimensions) }],
            source: {
              kind: 'plugin',
              plugin: name,
              form: 'notice',
              summary: m.announceSummary(selected.map((c) => c.id).join(', ')).slice(0, SUMMARY_MAX),
            },
          }))
        }

        return {
          kind: 'success',
          text: m.started(id, selected.length, dimensions, config.outputDir),
        }
      }

      // Blocking fallback: no `ctx.jobs`, or background disabled by config.
      try {
        return { kind: 'success', text: await execute(invocation.signal, () => {}) }
      } catch (error) {
        return { kind: 'error', text: m.failed(error instanceof Error ? error.message : String(error)) }
      }
    },
  }))

  ctx.logger.info(`harness-audit ready: ${CHECKS.length} checks defined`)
}
