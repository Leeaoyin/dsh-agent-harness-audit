/**
 * Localisation. The table is only useful if both languages stay complete and
 * the structural parts of the report survive translation.
 */
import assert from 'node:assert/strict'
import { suite } from './helpers.mjs'
import { messages, resolveLanguage } from '../src/i18n.ts'
import { renderMarkdown } from '../src/render.ts'

const { t, state } = suite('i18n')

const en = messages('en')
const zh = messages('zh')

t('both tables expose the same keys', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
})

t('no key is left untranslated', () => {
  const same = Object.keys(en).filter((k) => typeof en[k] === 'string' && en[k] === zh[k])
  assert.deepEqual(same, [], `identical in both languages: ${same.join(', ')}`)
})

t('function-valued keys stay functions in both', () => {
  for (const k of Object.keys(en)) assert.equal(typeof en[k], typeof zh[k], k)
})

// ---- language resolution ----
const ctxWith = (preference) => ({
  get: (name) => (name === 'settings' ? { get: () => (preference === undefined ? {} : { preference }) } : undefined),
})

t('auto follows an explicit zh preference', () => assert.equal(resolveLanguage(ctxWith('zh'), 'auto'), 'zh'))
t('auto follows an explicit en preference', () => assert.equal(resolveLanguage(ctxWith('en'), 'auto'), 'en'))
// With no stored preference the host locale decides. That is the common case:
// a browser-driven Chinese UI stores nothing, so settings alone answered
// "English" for exactly the users who wanted Chinese.
const hostLanguage = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'

t('auto falls back to the host locale when no preference is stored', () => {
  assert.equal(resolveLanguage(ctxWith(undefined), 'auto'), hostLanguage)
})
t('auto falls back to the host locale without a settings service', () => {
  assert.equal(resolveLanguage({ get: () => undefined }, 'auto'), hostLanguage)
})
t('auto survives a throwing settings service', () => {
  assert.equal(resolveLanguage({ get: () => ({ get: () => { throw new Error('boom') } }) }, 'auto'), hostLanguage)
})
t('a stored preference outranks the host locale', () => {
  assert.equal(resolveLanguage(ctxWith('en'), 'auto'), 'en')
  assert.equal(resolveLanguage(ctxWith('zh'), 'auto'), 'zh')
})
t('an explicit config overrides the locale', () => {
  assert.equal(resolveLanguage(ctxWith('zh'), 'en'), 'en')
  assert.equal(resolveLanguage(ctxWith('en'), 'zh'), 'zh')
})
t('a junk preference does not leak through', () => {
  assert.equal(resolveLanguage(ctxWith('ja'), 'auto'), hostLanguage)
})

// ---- the report keeps its structure in both languages ----
const u = (i, o) => ({ inputTokens: i, outputTokens: o, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 })
const result = {
  meta: {
    runId: 'r', startedAt: '2026-08-14T00:00:00.000Z', finishedAt: '2026-08-14T00:01:00.000Z',
    durationMs: 60000, workspaceRoot: '/w', commit: 'abc1234', language: 'python',
    subagentProvider: 'spawn', concurrency: 1,
    maxTokensPerCheckAdvisory: 120000, requestedChecks: ['C14'], ranChecks: ['C14'],
    skippedChecks: [], unknownChecks: [], reconUsage: u(80, 12), totalUsage: u(120, 34),
    evidenceRejections: 1, rejectionsByReason: { 'evidence-not-found': 1 },
    findingCount: 1, landmarkCount: 1, lspAvailable: false, excludePaths: ['.venv'],
  },
  run: { landmarks: [{ kind: 'request-assembly', file: 'a.py', line: 1, confidence: 'high' }] },
  findings: [{
    check: 'C14', verdict: 'suspected', file: 'a.py', line: 1,
    claim: 'c', evidence: 'e', consequence: 'q', direction: 'd', confirmHint: 'h',
  }],
  outcomes: [{ id: 'C14', priority: 1, status: 'ran', missingLandmarks: [], findingCount: 1, rejectionCount: 1, usage: u(40, 22) }],
}

const zhReport = renderMarkdown(result, zh)
const enReport = renderMarkdown(result, en)

t('zh report is actually Chinese', () => {
  assert.ok(zhReport.includes('# Harness 健壮性审计'))
  assert.ok(zhReport.includes('## 总览'))
  assert.ok(zhReport.includes('## 未覆盖'))
  assert.ok(zhReport.includes('## 成本'))
})

t('structure survives translation — same section count and order', () => {
  const heads = (md) => [...md.matchAll(/^## (.+)$/gmu)].length
  assert.equal(heads(zhReport), heads(enReport))
})

t('check ids and locations are never translated', () => {
  for (const md of [zhReport, enReport]) {
    assert.ok(md.includes('### C14 · Prompt prefix determinism'), 'check id/name changed')
    assert.ok(md.includes('**a.py:1**'), 'location changed')
    assert.ok(md.includes('abc1234'), 'commit changed')
  }
})

t('the fabrication warning is translated, not dropped', () => {
  assert.ok(zhReport.includes('编造证据'))
  assert.ok(enReport.includes('fabricating'))
})

t('the not-covered warning is translated, not dropped', () => {
  const zhEmpty = renderMarkdown({ ...result, meta: { ...result.meta, ranChecks: [] }, outcomes: [{ ...result.outcomes[0], status: 'skipped-missing-landmarks', missingLandmarks: ['x'] }] }, zh)
  assert.ok(zhEmpty.includes('不代表没有问题'))
})

t('subagents are told which language to write findings in', () => {
  assert.ok(zh.outputLanguage.includes('中文'))
  assert.ok(messages('en').outputLanguage.includes('English'))
})

t('job label carries the dimensions, not the kind', () => {
  // The row already renders the kind; repeating it wastes the one line the
  // running job can show.
  assert.ok(!en.jobLabel('C1', 'Tool-call pairing completeness', 1).includes('harness'))
  assert.ok(en.jobLabel('C1', 'Tool-call pairing completeness', 1).includes('Tool-call pairing'))
})

t('job label degrades to a count for multiple dimensions', () => {
  const label = en.jobLabel('C1, C4, C9', 'Tool-call pairing completeness', 3)
  assert.ok(label.includes('C1, C4, C9'))
  assert.ok(label.includes('3'))
})

t('terminal job detail states the numbers that matter', () => {
  const d = en.jobDetail(3, 1, 46000, 17000)
  assert.ok(d.includes('3') && d.includes('1') && d.includes('46000'))
  const z = zh.jobDetail(3, 1, 46000, 17000)
  assert.ok(z.includes('拒收'))
})

// ---- start notice ----
t('announce tells the model not to do the work itself', () => {
  const a = en.announce('harness-audit-1', 'C1 (Tool-call pairing completeness)')
  assert.ok(/do not start auditing/i.test(a), 'missing "do not audit" instruction')
  assert.ok(/do not call any tool/i.test(a), 'missing "no tools" instruction')
})

t('announce names the job and the dimensions', () => {
  const a = en.announce('harness-audit-1', 'C1 (Tool-call pairing completeness)')
  assert.ok(a.includes('harness-audit-1'))
  assert.ok(a.includes('C1'))
})

t('zh announce is Chinese and keeps the same restrictions', () => {
  const a = zh.announce('harness-audit-1', 'C1(工具调用配对完整性)')
  assert.ok(a.includes('不要自己去审计'))
  assert.ok(a.includes('不要调用任何工具'))
  assert.ok(a.includes('harness-audit-1'))
})

t('announce summary fits the 120-char notice cap in both languages', () => {
  // The seam caps a form:'notice' summary at CONTEXT_SUMMARY_MAX_CHARS.
  const many = 'C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12, C13, C14, C15'
  for (const table of [en, zh]) {
    assert.ok(table.announceSummary('C1').length <= 120)
    assert.ok(table.announceSummary(many).length <= 120, 'full check list overflows the cap')
  }
})

export default state
