/**
 * Prompt fragments shared by the recon and per-check subagents.
 *
 * These exist because the harness can present tools two ways. Under native
 * presentation the model calls tools directly; under Code Mode the ONLY
 * directly callable tool is `run_code`, and every capability is reached from
 * inside the program the model writes, through a generated SDK:
 *
 *   declare const tools: { [K in ToolName]: (args) => Promise<Output> }
 *
 * A prompt that says "call `report_finding`" reads as a native call and, with
 * no rule against it, invites a Code Mode model to reach for language
 * built-ins instead — the observed failure was a subagent writing
 * `import { execSync } from 'child_process'` to search the workspace, which
 * the sandbox rejects. The wording below is therefore mode-agnostic, and the
 * prohibition is explicit rather than implied.
 *
 * @module dsh-harness-audit/prompt
 */

/** How to reach capabilities, and what is off-limits, in either presentation. */
export const CAPABILITY_PREAMBLE = [
  'Reaching your capabilities:',
  '',
  'If the only tool you can call directly is `run_code`, this harness presents tools as a',
  'code SDK — reach every capability from inside the program you write, as',
  '`await tools.<name>({ … })` (for example `await tools.grep({ … })` or',
  '`await tools.report_finding({ … })`). Otherwise call them directly by name.',
  '',
  'Inspect the codebase ONLY through the capabilities you were given (`read`, `grep`,',
  '`glob`, and `skill`). Do not use language built-ins or the shell for this — no',
  '`require`, no `import` of `child_process`/`fs`/`path`, no `execSync`, no directory',
  'listing commands. Those are not available to you and the attempt will fail.',
].join('\n')

/** What counts as the project under audit. */
export function scopePreamble(excludes: readonly string[]): string {
  if (excludes.length === 0) {
    return [
      'Scope override: the operator has cleared the exclusion list for this run, so every path',
      'in the workspace is in scope — including vendored dependencies. This is the deliberate',
      'case of auditing a harness library itself, where that library IS the project under audit.',
    ].join('\n')
  }
  return [
    'Scope: audit only code this project authored. Installed dependencies, vendored frameworks,',
    'and build output are out of scope — a bare search matches inside them, and following those',
    'hits produces a report about somebody else\'s code that the reader cannot act on. When the',
    'project builds on a framework, audit how THIS project uses and configures it, not the',
    "framework's own internals.",
    '',
    'This is ENFORCED, not merely asked: reporting a landmark or a finding inside one of these',
    'directory names is refused, at any depth in the path.',
    excludes.map((e) => `\`${e}\``).join(', ') + '.',
  ].join('\n')
}
