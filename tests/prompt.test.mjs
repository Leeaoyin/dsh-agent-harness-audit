/**
 * Prompt guarantees. These are assertions about wording because the wording is
 * load-bearing: a Code Mode subagent that is not told how to reach its tools
 * reaches for `child_process` instead, and one that is not told zero findings
 * are acceptable invents findings to look useful.
 */
import assert from 'node:assert/strict'
import { suite } from './helpers.mjs'
import { CAPABILITY_PREAMBLE } from '../src/prompt.ts'
import { reconPrompt } from '../src/recon.ts'
import { checkPrompt } from '../src/orchestrate.ts'
import { CHECK_BY_ID } from '../src/checks.ts'
import { messages } from '../src/i18n.ts'

const zh = messages('zh')

const { t, state } = suite('prompts')

const landmarks = [
  { kind: 'request-assembly', file: 'src/req.ts', line: 12, symbol: 'build', confidence: 'high' },
  { kind: 'system-prompt-build', file: 'src/sys.ts', line: 30, confidence: 'low' },
  { kind: 'truncation', file: 'src/trunc.ts', line: 5, confidence: 'high' },
]
const excludes = ['.venv', 'node_modules']
const c14 = checkPrompt(CHECK_BY_ID.get('C14'), landmarks, 'TypeScript', 120000, excludes, zh.outputLanguage)
const recon = reconPrompt(excludes, zh.outputLanguage)

// ---- Code Mode support ----
t('preamble explains the code-SDK call shape', () => {
  assert.ok(CAPABILITY_PREAMBLE.includes('run_code'))
  assert.ok(CAPABILITY_PREAMBLE.includes('await tools.'))
})
t('preamble forbids the built-ins that actually broke a run', () => {
  for (const banned of ['require', 'child_process', 'execSync', 'import']) {
    assert.ok(CAPABILITY_PREAMBLE.includes(banned), `missing prohibition: ${banned}`)
  }
})
t('preamble names the allowed inspection capabilities', () => {
  for (const tool of ['read', 'grep', 'glob', 'skill']) {
    assert.ok(CAPABILITY_PREAMBLE.includes(tool), `missing capability: ${tool}`)
  }
})
t('both subagent prompts carry the preamble', () => {
  assert.ok(recon.includes(CAPABILITY_PREAMBLE), 'recon prompt missing preamble')
  assert.ok(c14.includes(CAPABILITY_PREAMBLE), 'check prompt missing preamble')
})
t('neither prompt phrases tool use as a native-only call', () => {
  assert.ok(!/Call `report_finding`/u.test(c14))
  assert.ok(!/Call `report_landmark`/u.test(recon))
})

// ---- anti-fabrication wording ----
t('check prompt states zero findings is acceptable', () => {
  assert.ok(/[Zz]ero findings is a normal and/u.test(c14))
})
t('check prompt restricts to exactly one check', () => {
  assert.ok(c14.includes('check **C14 · Prompt prefix determinism**'))
  assert.ok(c14.includes('and nothing else'))
})
t('check prompt warns that evidence is verified', () => {
  assert.ok(c14.includes('checked against the file'))
})
t('check prompt requires a location', () => {
  // Carried by the evidence rules now, not by a sentence of the prompt's own.
  assert.ok(/line number/iu.test(c14))
  assert.ok(/No location, no finding/iu.test(c14))
})
t('recon prompt forbids inventing landmarks', () => {
  assert.ok(recon.includes('Do not invent one'))
  assert.ok(recon.includes('normal result'))
})
t('recon prompt forbids running checks', () => {
  assert.ok(recon.includes('Do NOT execute any of the check items'))
})

// ---- landmark scoping ----
t('check prompt lists only its own landmarks', () => {
  assert.ok(c14.includes('src/req.ts:12'), 'required landmark missing')
  assert.ok(c14.includes('src/sys.ts:30'), 'context landmark missing')
  assert.ok(!c14.includes('src/trunc.ts'), 'unrelated landmark leaked into the prompt')
})
t('check prompt names the language', () => {
  assert.ok(c14.includes('TypeScript'))
})
t('no landmarks renders explicitly rather than blank', () => {
  const bare = checkPrompt(CHECK_BY_ID.get('C14'), [], undefined, 1000, excludes)
  assert.ok(bare.includes('(none reported)'))
  assert.ok(bare.includes('unknown'))
})

t('both prompts carry the scope rule', () => {
  for (const p of [c14, recon]) {
    assert.ok(p.includes('.venv'), 'excluded name missing')
    assert.ok(/audit only code this project authored/iu.test(p), 'scope rule missing')
  }
})

t('both prompts carry the output-language directive', () => {
  for (const p of [c14, recon]) assert.ok(p.includes('输出语言'), 'directive missing')
})

t('the directive protects evidence from translation', () => {
  assert.ok(zh.outputLanguage.includes('逐字一致'))
  assert.ok(zh.outputLanguage.includes('拒收'))
  assert.ok(messages('en').outputLanguage.includes('EXACTLY'))
})

t('recon gets the directive too — it was previously omitted entirely', () => {
  assert.ok(recon.includes('输出语言'))
})

export default state
