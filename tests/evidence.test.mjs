/**
 * Evidence validation and deterministic summarisation — the two places the
 * plugin, rather than the skill, decides what survives into a report.
 */
import assert from 'node:assert/strict'
import { suite } from './helpers.mjs'
import { evidenceMatches } from '../src/findings.ts'
import { dedupeFindings } from '../src/orchestrate.ts'
import { selectChecks, CHECKS } from '../src/checks.ts'

const { t, state } = suite('evidence & summarisation')

const file = [
  'function build(state) {',            // 1
  '  const parts = []',                 // 2
  '  for (const m of state.messages) {', // 3
  '    parts.push(render(m))',          // 4
  '  }',                                // 5
  '  return parts.join("\\n")',         // 6
  '}',                                  // 7
].join('\n')

t('exact line matches', () => assert.equal(evidenceMatches(file, 4, '    parts.push(render(m))'), true))
t('indentation is ignored', () => assert.equal(evidenceMatches(file, 4, 'parts.push(render(m))'), true))
t('internal whitespace runs collapse', () => assert.equal(evidenceMatches(file, 2, 'const   parts =    []'), true))
t('multi-line evidence spans the cited line', () => {
  assert.equal(evidenceMatches(file, 3, 'for (const m of state.messages) {\n  parts.push(render(m))'), true)
})
t('blank lines inside evidence are tolerated', () => {
  assert.equal(evidenceMatches(file, 3, 'for (const m of state.messages) {\n\n  parts.push(render(m))'), true)
})
t('CRLF content matches LF evidence', () => {
  assert.equal(evidenceMatches(file.replace(/\n/gu, '\r\n'), 4, 'parts.push(render(m))'), true)
})
t('+3 lines away still matches', () => assert.equal(evidenceMatches(file, 1, 'parts.push(render(m))'), true))
t('-3 lines away still matches', () => assert.equal(evidenceMatches(file, 7, 'parts.push(render(m))'), true))
t('beyond the window is refused', () => {
  const long = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')
  assert.equal(evidenceMatches(long, 2, 'line 30'), false)
})
t('fabricated evidence is refused', () => {
  assert.equal(evidenceMatches(file, 4, 'parts.push(sanitize(render(m)))'), false)
})
t('empty evidence is refused', () => assert.equal(evidenceMatches(file, 4, '   \n  '), false))

// ---- dedupe ----
const f = (check, path, line, verdict) => ({ check, file: path, line, verdict, claim: '', evidence: '', consequence: '' })

t('same check+file+line collapses', () => {
  assert.equal(dedupeFindings([f('C1', 'a.ts', 10, 'confirmed'), f('C1', 'a.ts', 10, 'confirmed')]).length, 1)
})
t('suspected beats confirmed', () => {
  assert.equal(dedupeFindings([f('C1', 'a.ts', 10, 'confirmed'), f('C1', 'a.ts', 10, 'suspected')])[0].verdict, 'suspected')
})
t('suspected wins regardless of order', () => {
  assert.equal(dedupeFindings([f('C1', 'a.ts', 10, 'suspected'), f('C1', 'a.ts', 10, 'confirmed')])[0].verdict, 'suspected')
})
t('distinct lines are kept', () => {
  assert.equal(dedupeFindings([f('C1', 'a.ts', 10, 'confirmed'), f('C1', 'a.ts', 11, 'confirmed')]).length, 2)
})
t('a path containing the separator cannot collide', () => {
  assert.equal(dedupeFindings([f('C1', 'a b.ts', 1, 'confirmed'), f('C1', 'a', 1, 'confirmed')]).length, 2)
})

// ---- selection ----
t('floor 1 yields only P1', () => {
  const { selected } = selectChecks([], 1)
  assert.ok(selected.length > 0 && selected.every((c) => c.priority === 1))
})
t('floor 2 yields everything', () => assert.equal(selectChecks([], 2).selected.length, CHECKS.length))
t('an explicit id overrides the floor', () => {
  assert.deepEqual(selectChecks(['C2'], 1).selected.map((c) => c.id), ['C2'])
})
t('ids are case and space insensitive', () => {
  assert.deepEqual(selectChecks([' c14 '], 2).selected.map((c) => c.id), ['C14'])
})
t('unknown ids are surfaced, not dropped silently', () => {
  const { selected, unknown } = selectChecks(['C14', 'C99'], 2)
  assert.deepEqual(selected.map((c) => c.id), ['C14'])
  assert.deepEqual(unknown, ['C99'])
})
t('duplicates collapse', () => assert.equal(selectChecks(['C14', 'C14'], 2).selected.length, 1))

// ---- table integrity ----
t('check ids are unique', () => assert.equal(new Set(CHECKS.map((c) => c.id)).size, CHECKS.length))
t('no landmark is both required and context', () => {
  for (const c of CHECKS) {
    assert.equal(c.requires.filter((k) => c.context.includes(k)).length, 0, c.id)
  }
})
t('every check has at least one required landmark', () => {
  for (const c of CHECKS) assert.ok(c.requires.length > 0, c.id)
})

export default state
