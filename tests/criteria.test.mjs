/**
 * Criteria coverage.
 *
 * This replaces the old skill-agreement suite. That one parsed the bundled
 * `SKILL.md` and asserted the plugin's table matched it; there is no second
 * document now, so the job changes from "do the two agree" to "does every
 * check the plugin offers actually carry criteria a subagent can judge by".
 *
 * The failure this guards is specific: a check listed in the picker, selected
 * by the user, dispatched to a subagent — with an empty criteria string. The
 * subagent would have a landmark, a check name, and no standard, and would
 * invent one.
 */
import assert from 'node:assert/strict'
import { suite } from './helpers.mjs'
import { CHECK_CRITERIA, EVIDENCE_RULES, LANDMARK_GUIDE } from '../src/criteria.ts'
import { CHECKS, LANDMARK_KINDS } from '../src/checks.ts'
import { checkPrompt } from '../src/orchestrate.ts'
import { reconPrompt } from '../src/recon.ts'

const { t, state } = suite('criteria')

t('every check has criteria', () => {
  for (const check of CHECKS) {
    const text = CHECK_CRITERIA[check.id]
    assert.ok(text !== undefined && text.trim().length > 0, `${check.id} has no criteria`)
  }
})

t('no criteria exist for a check the plugin does not offer', () => {
  const known = new Set(CHECKS.map((c) => c.id))
  for (const id of Object.keys(CHECK_CRITERIA)) {
    assert.ok(known.has(id), `criteria exist for unknown check ${id}`)
  }
})

t('criteria are substantive, not placeholders', () => {
  for (const check of CHECKS) {
    assert.ok(CHECK_CRITERIA[check.id].length > 200, `${check.id} criteria look truncated`)
  }
})

t('each check states its symptom and what confirms it', () => {
  // Without "confirmed when", a subagent has no threshold and every
  // observation becomes a finding.
  for (const check of CHECKS) {
    const text = CHECK_CRITERIA[check.id]
    assert.ok(/\*\*Symptom\.\*\*/u.test(text), `${check.id} has no symptom`)
    assert.ok(/Confirmed when/iu.test(text), `${check.id} has no confirmation threshold`)
  }
})

t('the landmark guide covers every landmark kind the plugin accepts', () => {
  for (const kind of LANDMARK_KINDS) {
    // The guide writes them as prose ("tool execution"), the code as slugs.
    const spelled = kind.replace(/-/gu, ' ')
    assert.ok(LANDMARK_GUIDE.includes(spelled), `landmark guide omits ${kind}`)
  }
})

t('evidence rules are present and demand a location', () => {
  assert.ok(EVIDENCE_RULES.length > 200)
  assert.ok(/file path/iu.test(EVIDENCE_RULES), 'no file path requirement')
  assert.ok(/line number/iu.test(EVIDENCE_RULES), 'no line number requirement')
  assert.ok(/No location, no finding/iu.test(EVIDENCE_RULES), 'the rule is not stated absolutely')
})

// ---- the criteria actually reach the subagent ----
const landmarks = [{ kind: 'tool-execution', file: 'a.py', line: 1, confidence: 'high' }]

t('a check prompt carries that check criteria verbatim', () => {
  const p = checkPrompt(CHECKS[0], landmarks, 'python', 1000, ['.venv'])
  assert.ok(p.includes(CHECK_CRITERIA.C1), 'C1 criteria missing from its prompt')
})

t('a check prompt carries no other check criteria', () => {
  // One check per subagent: the prompt must not let a finding drift into a
  // neighbouring check's territory, and must not pay for fourteen unused ones.
  const p = checkPrompt(CHECKS[0], landmarks, 'python', 1000, ['.venv'])
  for (const check of CHECKS.slice(1)) {
    assert.ok(!p.includes(CHECK_CRITERIA[check.id]), `${check.id} criteria leaked into the C1 prompt`)
  }
})

t('a check prompt carries the evidence rules', () => {
  assert.ok(checkPrompt(CHECKS[0], landmarks, 'python', 1000, []).includes(EVIDENCE_RULES))
})

t('the recon prompt carries the landmark guide', () => {
  assert.ok(reconPrompt(['.venv']).includes(LANDMARK_GUIDE))
})

t('no prompt tells the subagent to load a skill', () => {
  // The indirection is gone; an instruction to load one would send the
  // subagent looking for a document that is not installed.
  for (const p of [checkPrompt(CHECKS[0], landmarks, 'python', 1000, []), reconPrompt(['.venv'])]) {
    assert.ok(!/load the skill/iu.test(p), 'prompt still asks for a skill')
  }
})

export default state
