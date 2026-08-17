/**
 * Dimension picker for `/harness-audit` with no arguments.
 *
 * Typing `--checks C1` means knowing both the flag and the id table before you
 * can run anything, which is a poor first experience. `ctx.userQuestions` is a
 * host-side seam that presents a real choice to the human and returns the
 * answer, so the bare command can ask instead of demand.
 *
 * The service is OPTIONAL. A composition without a question UI (headless, ACP)
 * must still be able to run an audit, so every failure path falls back to the
 * configured selection rather than refusing.
 *
 * @module dsh-harness-audit/picker
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-user-questions'
import { CHECKS } from './checks.ts'
import type { Messages } from './i18n.ts'

/** Question id; echoed back in the answer. */
const QUESTION_ID = 'harness-audit-dimensions'

/** Prefix of an option label, up to the separator, is the check id. */
function idOf(label: string): string | undefined {
  const match = /^(C\d{1,2})\b/u.exec(label.trim())
  return match?.[1]
}

/**
 * Options in the check table's own order — C1, C2, C3, … — never re-sorted.
 *
 * An earlier version floated the P1 checks to the top so the most valuable
 * ones came first. That reads as a shuffled list: the ids jump C1, C4, C9,
 * C10, then back to C2, and a reader scanning for a number cannot find it.
 * Priority is conveyed by the label's marker instead, which costs nothing and
 * leaves the sequence scannable.
 */
export function buildOptions(m: Messages): { label: string; description: string }[] {
  return CHECKS.map((check) => ({
    // The id stays in the label because the answer echoes labels back and
    // `idOf` reads it — but the description is what makes the option legible
    // to someone who has never seen the id table.
    label: `${check.id} · ${check.name}${check.priority === 1 ? m.pickP1Suffix : ''}`,
    description: m.checkGloss[check.id] ?? check.group,
  }))
}

/**
 * Outcome of asking. `unavailable` and `dismissed` are deliberately distinct:
 * a composition with no question UI must still be able to audit, so it falls
 * back to configuration — but a human who closed the prompt said "never
 * mind", and starting a full fifteen-dimension run on that would be a costly
 * misreading of a cancel.
 */
export type PickResult =
  | { kind: 'picked'; checks: string[] }
  | { kind: 'dismissed' }
  | { kind: 'unavailable' }

/** Ask which dimensions to audit. */
export async function pickDimensions(
  ctx: Context,
  m: Messages,
  agent: Agent,
  signal: AbortSignal,
): Promise<PickResult> {
  const questions = ctx.get('userQuestions')
  if (questions === undefined) return { kind: 'unavailable' }

  try {
    const answer = await questions.ask({
      questions: [{
        id: QUESTION_ID,
        question: m.pickQuestion,
        detail: m.pickDetail,
        header: m.pickHeader,
        multiSelect: true,
        options: buildOptions(m),
      }],
      agent,
      signal,
    })

    const item = answer.answers.find((q) => q.id === QUESTION_ID)
    const ids = (item?.selected ?? []).map(idOf).filter((id): id is string => id !== undefined)
    return ids.length > 0 ? { kind: 'picked', checks: ids } : { kind: 'dismissed' }
  } catch {
    // A cancelled prompt must not fail the command, and must not be read as
    // consent to audit everything either.
    return { kind: 'dismissed' }
  }
}
