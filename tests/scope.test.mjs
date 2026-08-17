/**
 * Audit scope. The first live run located all 23 landmarks inside
 * `.venv/Lib/site-packages/agno/` and reported findings in third-party code,
 * so this is enforced rather than merely requested.
 */
import assert from 'node:assert/strict'
import { suite } from './helpers.mjs'
import { excludedBy, excludedMessage, DEFAULT_EXCLUDES } from '../src/scope.ts'
import { scopePreamble } from '../src/prompt.ts'
import { Config } from '../src/config.ts'

const { t, state } = suite('scope')

const D = DEFAULT_EXCLUDES

// ---- the exact path that motivated this ----
t('the real-world path is excluded', () => {
  assert.equal(excludedBy('.venv\\Lib\\site-packages\\agno\\models\\base.py', D), '.venv')
})
t('posix separators work too', () => {
  assert.equal(excludedBy('.venv/lib/site-packages/agno/models/base.py', D), '.venv')
})
t('site-packages alone is excluded', () => {
  assert.equal(excludedBy('lib/site-packages/x.py', D), 'site-packages')
})
t('node_modules is excluded', () => {
  assert.equal(excludedBy('node_modules/foo/index.js', D), 'node_modules')
})
t('a nested dependency dir is caught anywhere in the path', () => {
  assert.equal(excludedBy('services/api/node_modules/x/y.js', D), 'node_modules')
})

// ---- first-party code must survive ----
t('project source is in scope', () => {
  assert.equal(excludedBy('agents/websearch.py', D), undefined)
  assert.equal(excludedBy('app/main.py', D), undefined)
  assert.equal(excludedBy('src/index.ts', D), undefined)
})
t('leading ./ is tolerated', () => {
  assert.equal(excludedBy('./app/main.py', D), undefined)
})

// ---- segment matching, not substring ----
t('a substring match does not exclude', () => {
  assert.equal(excludedBy('src/vendored-rules/apply.ts', D), undefined)
  assert.equal(excludedBy('src/build-tools/run.ts', D), undefined)
  assert.equal(excludedBy('lib/distribution/index.ts', D), undefined)
})
t('an exact segment does exclude', () => {
  assert.equal(excludedBy('src/vendor/lib.ts', D), 'vendor')
  assert.equal(excludedBy('build/out.js', D), 'build')
})
t('matching is case-insensitive', () => {
  assert.equal(excludedBy('Lib/Site-Packages/x.py', D), 'Site-Packages')
})

// ---- opt-out ----
t('an empty exclude list disables the check', () => {
  assert.equal(excludedBy('.venv/lib/site-packages/agno/base.py', []), undefined)
})

// ---- refusal text is actionable ----
t('refusal names the path and the offending segment', () => {
  const msg = excludedMessage('.venv/x.py', '.venv')
  assert.ok(msg.includes('.venv/x.py'))
  assert.ok(msg.includes('"\.venv"'.replace('\\', '')))
  assert.ok(msg.includes('own source'))
})
t('refusal tells the model not to retry it', () => {
  assert.ok(excludedMessage('a/b', 'b').includes('do not report it from here'))
})

// ---- prompt ----
t('scope preamble lists the excluded names', () => {
  const p = scopePreamble(D)
  assert.ok(p.includes('.venv'))
  assert.ok(p.includes('site-packages'))
  assert.ok(p.includes('node_modules'))
})
t('scope preamble states the rule itself', () => {
  // There is no skill to defer to any more; the prompt is the only place a
  // subagent can learn this.
  const p = scopePreamble(D)
  assert.ok(/audit only code this project authored/iu.test(p), 'rule missing')
  assert.ok(!/skill/iu.test(p), 'preamble still refers to a skill that is not installed')
})
t('scope preamble says the rule is enforced, not merely requested', () => {
  assert.ok(scopePreamble(D).includes('ENFORCED'))
})
t('empty excludes produce an explicit everything-in-scope statement', () => {
  assert.ok(scopePreamble([]).includes('including vendored dependencies'))
})

// ---- config default ----
t('config defaults to excluding dependencies', () => {
  const c = new Config({})
  assert.ok(c.excludePaths.includes('.venv'))
  assert.ok(c.excludePaths.includes('site-packages'))
  assert.ok(c.excludePaths.includes('node_modules'))
})
t('config allows opting out with an empty list', () => {
  assert.deepEqual(new Config({ excludePaths: [] }).excludePaths, [])
})

export default state
