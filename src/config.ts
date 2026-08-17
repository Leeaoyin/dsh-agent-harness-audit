/**
 * Plugin configuration. Every value a deployment might reasonably want to
 * change is a field here; nothing tunable is hardcoded elsewhere in the
 * plugin (docs/user/develop/basic/config.zh.md).
 *
 * @module dsh-harness-audit/config
 */

import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { DEFAULT_EXCLUDES } from './scope.ts'

export interface Config {
  /** Check ids to run; empty runs every check the priority floor admits. */
  checks: string[]
  /** Run checks whose priority number is at most this value (1 = P1 only). */
  priorityFloor: 1 | 2
  /** Checks fanned out concurrently. 1 is a supported, tested path. */
  concurrency: number
  /** Subagent provider name used for recon and every check child. */
  subagentProvider: string
  /** Advisory per-check token budget recorded in run metadata. */
  maxTokensPerCheck: number
  /** Workspace-relative directory the two reports are written to. */
  outputDir: string
  /**
   * Run the audit as a background job instead of blocking the command.
   * A blocking command produces no turn, so the UI has nothing to attach
   * progress to until the session's next turn; a job is observable and
   * cancellable while it runs. Falls back to blocking when `ctx.jobs` is
   * absent.
   */
  background: boolean
  /**
   * Announce the start of a backgrounded audit into the conversation.
   *
   * A command produces no turn, and every conversation UI slot that could show
   * a running job is `scope: 'session'` — strictly gated on an existing
   * session. In a NEW conversation that means the command appears to do
   * nothing at all. Steering one notice starts a turn on an idle driver, after
   * which the session-scoped surfaces (job list, subagent indicator) render.
   *
   * Costs one short model request per audit, against the 46K–190K tokens an
   * audit itself spends.
   */
  announceOnStart: boolean
  /** Attempt LSP-backed navigation, degrading to text search on LspError. */
  useLsp: boolean
  /** Emit a model-written cross-check section, explicitly marked unvalidated. */
  crossCheckAnalysis: boolean
  /**
   * Language for user-facing output. `auto` follows the harness locale
   * setting, falling back to English when no preference is stored.
   */
  language: 'auto' | 'en' | 'zh'
  /**
   * Directory names treated as out of scope, matched per path segment.
   * Landmarks and findings inside them are refused. Set to `[]` to audit a
   * vendored framework deliberately.
   */
  excludePaths: string[]
}

export const Config: Schema<Config> = z.object({
  checks: z.array(z.string()).default([]),
  priorityFloor: z.union([1, 2] as const).default(2),
  concurrency: z.number().step(1).min(1).max(16).default(3),
  subagentProvider: z.string().default('spawn'),
  maxTokensPerCheck: z.number().step(1).min(1000).default(120000),
  outputDir: z.string().default('.harness-audit'),
  announceOnStart: z.boolean().default(true),
  background: z.boolean().default(true),
  useLsp: z.boolean().default(true),
  crossCheckAnalysis: z.boolean().default(false),
  language: z.union(['auto', 'en', 'zh'] as const).default('auto'),
  excludePaths: z.array(z.string()).default([...DEFAULT_EXCLUDES]),
})
