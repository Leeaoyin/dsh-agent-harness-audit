/**
 * Command argument parsing.
 *
 * Two real failures shaped this. First, a user typed `--check c2` (singular);
 * the parser matched only `--checks`, reported "no flag given", and the
 * handler fell through to the profile's configured `checks: ['C14']` — the
 * audit ran a different dimension and said nothing. Second, the flag itself
 * turned out to be more ceremony than anyone wanted to type.
 *
 * So: the flag is optional, ids are accepted bare, presets exist — and input
 * that still cannot be interpreted is REFUSED rather than silently redirected.
 */
import assert from 'node:assert/strict'
import { suite } from './helpers.mjs'
import { parseAuditArgs } from '../src/args.ts'
import { selectChecks } from '../src/checks.ts'

const { t, state } = suite('command args')

const checksOf = (raw) => {
  const a = parseAuditArgs(raw)
  assert.equal(a.kind, 'checks', `expected ids from ${JSON.stringify(raw)}, got ${a.kind}`)
  return a.checks
}

// ---- the short form people actually want to type ----
t('a bare id', () => assert.deepEqual(checksOf('C1'), ['C1']))
t('a bare lowercase id', () => assert.deepEqual(checksOf('c1'), ['C1']))
t('bare ids, comma separated', () => assert.deepEqual(checksOf('C1,C9'), ['C1', 'C9']))
t('bare ids, space separated', () => assert.deepEqual(checksOf('C1 C9 C14'), ['C1', 'C9', 'C14']))
t('leading whitespace is tolerated', () => assert.deepEqual(checksOf('   C1'), ['C1']))

// ---- the flag still works, in every spelling that bit us ----
t('--checks', () => assert.deepEqual(checksOf('--checks C1'), ['C1']))
t('--check singular', () => assert.deepEqual(checksOf('--check c2'), ['C2']))
t('-c short form', () => assert.deepEqual(checksOf('-c C2'), ['C2']))
t('--checks= form', () => assert.deepEqual(checksOf('--checks=C1'), ['C1']))
t('--checks with spaces after commas', () => assert.deepEqual(checksOf('--checks C1, C9'), ['C1', 'C9']))

t('the exact input that mis-ran now selects C2', () => {
  assert.deepEqual(selectChecks(checksOf(' --check c2'), 2).selected.map((c) => c.id), ['C2'])
})

// ---- presets ----
const presetOf = (raw) => {
  const a = parseAuditArgs(raw)
  assert.equal(a.kind, 'preset', `expected a preset from ${JSON.stringify(raw)}`)
  return a.preset
}
t('p1 preset', () => assert.equal(presetOf('p1'), 'p1'))
t('P1 uppercase', () => assert.equal(presetOf('P1'), 'p1'))
t('quick aliases p1', () => assert.equal(presetOf('quick'), 'p1'))
t('all preset', () => assert.equal(presetOf('all'), 'all'))
t('full aliases all', () => assert.equal(presetOf('full'), 'all'))
t('p1 selects exactly the seven P1 checks', () => {
  const { selected } = selectChecks([], 1)
  assert.deepEqual(selected.map((c) => c.id), ['C1', 'C4', 'C9', 'C10', 'C12', 'C13', 'C14'])
})
t('all selects fifteen', () => assert.equal(selectChecks([], 2).selected.length, 15))

// ---- empty means "ask / use configuration", never "audit nothing" ----
t('empty input', () => assert.equal(parseAuditArgs('').kind, 'empty'))
t('whitespace-only input', () => assert.equal(parseAuditArgs('   ').kind, 'empty'))

// ---- refusal, not silent fallback ----
const refused = (raw) => {
  const a = parseAuditArgs(raw)
  assert.equal(a.kind, 'unparsed', `expected refusal for ${JSON.stringify(raw)}`)
  return a.raw
}
t('an unknown flag is refused', () => assert.equal(refused('--only C2'), '--only C2'))
t('a misspelled flag is refused', () => assert.equal(refused('--cheks C2'), '--cheks C2'))
t('a flag with no ids is refused', () => assert.equal(refused('--checks'), '--checks'))
t('trailing garbage is refused', () => refused('--checks C1 --verbose'))
t('a non-id word is refused', () => refused('everything please'))
t('a malformed id is refused', () => refused('C'))
t('an over-long id is refused', () => refused('C123'))
t('mixing a preset with ids is refused', () => {
  // Ambiguous: does the id widen the preset or narrow it?
  refused('p1 C14')
})

// ---- selection semantics ----
t('an explicit id bypasses the priority floor', () => {
  // C2 is P2; a floor of 1 must not veto a check the user named.
  assert.deepEqual(selectChecks(['C2'], 1).selected.map((c) => c.id), ['C2'])
})
t('unknown ids are reported separately', () => {
  const { selected, unknown } = selectChecks(['C1', 'C99'], 2)
  assert.deepEqual(selected.map((c) => c.id), ['C1'])
  assert.deepEqual(unknown, ['C99'])
})
t('duplicate ids collapse', () => {
  assert.deepEqual(selectChecks(['C1', 'C1'], 2).selected.map((c) => c.id), ['C1'])
})

// ---- landmark dependencies behind the not-covered reason ----
t('C1 requires tool-execution', () => {
  assert.deepEqual([...selectChecks(['C1'], 2).selected[0].requires], ['tool-execution'])
})
t('C2 requires history-append', () => {
  assert.deepEqual([...selectChecks(['C2'], 2).selected[0].requires], ['history-append'])
})

export default state
