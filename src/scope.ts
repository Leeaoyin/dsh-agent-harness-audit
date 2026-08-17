/**
 * Audit scope: which paths count as the project under audit.
 *
 * A first run against a Python project located every one of its 23 landmarks
 * inside `.venv/Lib/site-packages/agno/` — it audited the vendored framework
 * rather than the project, produced findings in third-party code the user
 * cannot act on, and paid for reading a dependency tree to do it.
 *
 * Telling the subagent to stay in first-party code is necessary but not
 * sufficient, for the same reason the evidence rules are not sufficient on
 * their own: a prompt can ask, only a tool can refuse. Both reporting tools
 * therefore reject an excluded path, and the subagent is told why so it can
 * look somewhere else instead of retrying.
 *
 * @module dsh-harness-audit/scope
 */

/**
 * Directory names that mark dependency or build output rather than authored
 * code. Matched per path SEGMENT, never as a substring: a project directory
 * legitimately named `vendored-rules` must not be excluded by `vendor`.
 */
export const DEFAULT_EXCLUDES: readonly string[] = [
  '.venv',
  'venv',
  'site-packages',
  'node_modules',
  'vendor',
  'third_party',
  'bower_components',
  '.git',
  'dist',
  'build',
  'target',
  '__pycache__',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.next',
  '.nuxt',
  'Pods',
]

/** Split a workspace-relative path into segments, tolerating either separator. */
function segments(path: string): string[] {
  return path.split(/[\\/]+/u).filter((s) => s.length > 0 && s !== '.')
}

/**
 * Whether a workspace-relative path lies inside an excluded directory.
 * @param path - workspace-relative path as reported by a subagent.
 * @param excludes - directory names to exclude; empty disables the check.
 * @returns the matching segment, or `undefined` when the path is in scope.
 */
export function excludedBy(path: string, excludes: readonly string[]): string | undefined {
  if (excludes.length === 0) return undefined
  const lower = new Set(excludes.map((e) => e.toLowerCase()))
  for (const segment of segments(path)) {
    if (lower.has(segment.toLowerCase())) return segment
  }
  return undefined
}

/** The refusal text handed back to a subagent that reported an excluded path. */
export function excludedMessage(path: string, segment: string): string {
  return `"${path}" is inside "${segment}", which is dependency or build output rather than `
    + 'code authored by this project. Audit the project\'s own source instead. If the framework '
    + 'itself is the intended target, the operator must widen the audit scope in configuration — '
    + 'do not report it from here.'
}
