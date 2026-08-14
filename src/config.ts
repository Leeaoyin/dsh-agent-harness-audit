/**
 * Plugin configuration. Every value a deployment might reasonably want to
 * change is a field here; nothing tunable is hardcoded elsewhere in the
 * plugin (docs/user/develop/basic/config.zh.md).
 *
 * @module dsh-harness-audit/config
 */

import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'

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
  /** Attempt LSP-backed navigation, degrading to text search on LspError. */
  useLsp: boolean
  /** Emit a model-written cross-check section, explicitly marked unvalidated. */
  crossCheckAnalysis: boolean
  /** Skill supplying the criteria; allows pointing at a replacement. */
  skillName: string
}

export const Config: Schema<Config> = z.object({
  checks: z.array(z.string()).default([]),
  priorityFloor: z.union([1, 2] as const).default(2),
  concurrency: z.number().step(1).min(1).max(16).default(3),
  subagentProvider: z.string().default('spawn'),
  maxTokensPerCheck: z.number().step(1).min(1000).default(120000),
  outputDir: z.string().default('.harness-audit'),
  useLsp: z.boolean().default(true),
  crossCheckAnalysis: z.boolean().default(false),
  skillName: z.string().default('harness-evaluation'),
})
