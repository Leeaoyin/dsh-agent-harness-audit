/**
 * Command argument parsing.
 *
 * The original syntax was `--checks C1` and nothing else, which failed two
 * ways in real use: a user typed `--check c2` (singular) and the audit
 * silently ran the configured default instead, and the flag itself proved to
 * be more ceremony than people wanted to type. So the flag is now optional
 * decoration — `C1`, `c1`, `C1,C9`, `p1`, `all` all work — while genuinely
 * unrecognisable input is still REFUSED rather than quietly falling back to
 * something the user did not ask for.
 *
 * @module dsh-harness-audit/args
 */

/** What the user asked for, once parsed. */
export type AuditArgs =
  /** Nothing supplied: the caller decides (picker, or configured default). */
  | { kind: 'empty' }
  /** Explicit ids, in the order given. */
  | { kind: 'checks'; checks: string[] }
  /** A named breadth preset. */
  | { kind: 'preset'; preset: 'p1' | 'all' }
  /** Input carrying text that could not be interpreted. */
  | { kind: 'unparsed'; raw: string }

/** Words accepted in place of an id list. */
const PRESETS: Record<string, 'p1' | 'all'> = {
  p1: 'p1',
  P1: 'p1',
  quick: 'p1',
  critical: 'p1',
  all: 'all',
  full: 'all',
  everything: 'all',
}

/** A check id: `C` followed by digits, in any case. */
const CHECK_ID = /^c\d{1,2}$/iu

export function parseAuditArgs(rawInput: string): AuditArgs {
  let rest = rawInput.trim()
  if (rest.length === 0) return { kind: 'empty' }

  // The flag is optional; strip it when present so the rest parses the same
  // way with or without it.
  const flag = /^(?:--checks?|-c)(?:[=\s]+)/iu.exec(rest)
  if (flag !== null) {
    rest = rest.slice(flag[0].length).trim()
    if (rest.length === 0) return { kind: 'unparsed', raw: rawInput.trim() }
  }

  const tokens = rest.split(/[,\s]+/u).map((t) => t.trim()).filter((t) => t.length > 0)
  if (tokens.length === 0) return { kind: 'unparsed', raw: rawInput.trim() }

  // A preset is a whole-input answer; mixing it with ids is ambiguous about
  // whether the ids add to or narrow the preset, so it is refused.
  if (tokens.length === 1 && Object.hasOwn(PRESETS, tokens[0])) {
    return { kind: 'preset', preset: PRESETS[tokens[0]] }
  }
  if (tokens.some((t) => Object.hasOwn(PRESETS, t))) {
    return { kind: 'unparsed', raw: rawInput.trim() }
  }

  if (!tokens.every((t) => CHECK_ID.test(t))) return { kind: 'unparsed', raw: rawInput.trim() }
  return { kind: 'checks', checks: tokens.map((t) => t.toUpperCase()) }
}
