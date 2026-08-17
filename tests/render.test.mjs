/**
 * Report rendering. The assertions here are mostly about honesty properties:
 * a skipped check must never read as a clean one, and a suspected verdict must
 * not present as confirmed.
 */
import assert from 'node:assert/strict'
import { suite } from './helpers.mjs'
import { fileScopeSuffix, localDisplay, localStamp, renderMarkdown, renderJson } from '../src/render.ts'
import { messages } from '../src/i18n.ts'

const en = messages('en')

const { t, state } = suite('render')

const u = (i, o) => ({ inputTokens: i, outputTokens: o, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 })

const finding = {
  check: 'C14', verdict: 'suspected', file: 'src/req.ts', line: 12,
  claim: 'Timestamp injected into the system prefix.',
  evidence: 'const prefix = `${Date.now()} you are...`',
  consequence: 'Cache misses on every request.',
  direction: 'Hoist volatile values out of the cached prefix.',
  confirmHint: 'whether the prefix is rebuilt per request.',
}

const result = {
  meta: {
    runId: 'audit-test', startedAt: '2026-08-14T00:00:00.000Z', finishedAt: '2026-08-14T00:01:00.000Z',
    durationMs: 60000, workspaceRoot: '/w', commit: 'abc1234', language: 'TypeScript',
    subagentProvider: 'spawn', concurrency: 1,
    maxTokensPerCheckAdvisory: 120000, requestedChecks: ['C13', 'C14'], ranChecks: ['C14'],
    skippedChecks: ['C13'], unknownChecks: [], reconUsage: u(80, 12), totalUsage: u(120, 34),
    evidenceRejections: 2, rejectionsByReason: { 'evidence-not-found': 2 },
    findingCount: 1, landmarkCount: 1, lspAvailable: false,
    excludePaths: ['.venv', 'node_modules'],
  },
  run: { landmarks: [{ kind: 'request-assembly', file: 'src/req.ts', line: 12, symbol: 'build', confidence: 'high' }] },
  findings: [finding],
  outcomes: [
    { id: 'C13', priority: 1, status: 'skipped-missing-landmarks', missingLandmarks: ['truncation'], findingCount: 0, rejectionCount: 0, usage: u(0, 0) },
    { id: 'C14', priority: 1, status: 'ran', missingLandmarks: [], findingCount: 1, rejectionCount: 2, usage: u(40, 22) },
  ],
}

const md = renderMarkdown(result, en)

t('template title', () => assert.ok(md.startsWith('# Harness robustness audit')))
t('Target line carries path and commit', () => assert.ok(md.includes('Target: /w @ abc1234')))
t('counts line', () => assert.ok(md.includes('Checks run: 1    Findings: 0 confirmed / 1 suspected')))
t('mandatory sections present and ordered', () => {
  let at = -1
  for (const s of ['## Summary', '## Confirmed', '## Suspected', '## Not covered', '## Cost']) {
    const i = md.indexOf(s)
    assert.ok(i > at, `${s} missing or out of order`)
    at = i
  }
})
t('finding heading is C<n> · <name>', () => assert.ok(md.includes('### C14 · Prompt prefix determinism')))
t('finding shows file:line', () => assert.ok(md.includes('**src/req.ts:12**')))
t('Consequence rendered', () => assert.ok(md.includes('Consequence: Cache misses')))
t('Direction rendered', () => assert.ok(md.includes('Direction: Hoist volatile values')))
t('To confirm rendered for suspected', () => assert.ok(md.includes('To confirm, check whether the prefix')))
t('a suspected finding is not listed under Confirmed', () => {
  const seg = md.slice(md.indexOf('## Confirmed'), md.indexOf('## Suspected'))
  assert.ok(seg.includes('None.'))
  assert.ok(!seg.includes('C14'))
})
t('group summary states the group verdict', () => {
  assert.ok(md.includes('**Finite resources are accounted for** — suspected (1 finding)'))
})
t('skipped check listed with reason', () => {
  assert.ok(md.includes('| C13 |') && md.includes('truncation'))
})
t('unselected checks listed', () => assert.ok(/Not selected for this run: C1,/u.test(md)))
t('not-covered warns against reading as clean', () => assert.ok(md.includes('not that nothing is wrong')))
t('total cost stated', () => assert.ok(md.includes('input 120, output 34')))
t('recon billed separately', () => assert.ok(md.includes('| _recon_ | ran | — | — | 80/12 |')))
t('cost table totals', () => assert.ok(md.includes('**120/34**')))
t('rejections surfaced with the fabrication warning', () => {
  assert.ok(md.includes('evidence-not-found: 2'))
  assert.ok(md.includes('fix the prompts, not the validation'))
})

t('evidence cannot break out of its fence', () => {
  const evil = { ...result, findings: [{ ...finding, evidence: '```\n## Injected heading' }] }
  assert.ok(!renderMarkdown(evil, en).includes('\n```\n## Injected heading'))
})
t('not-implemented gets its own section', () => {
  const ni = { ...result, findings: [{ ...finding, verdict: 'not-implemented', confirmHint: undefined }] }
  const out = renderMarkdown(ni, en)
  assert.ok(out.includes('## Not implemented') && out.includes('That is not a pass.'))
})
t('zero findings still renders every mandatory section', () => {
  const empty = { ...result, findings: [], meta: { ...result.meta, findingCount: 0 } }
  const out = renderMarkdown(empty, en)
  for (const s of ['## Summary', '## Confirmed', '## Suspected', '## Not covered', '## Cost']) {
    assert.ok(out.includes(s), `${s} missing`)
  }
  assert.ok(out.includes('no findings (1/2 checked)'))
})
t('a fully skipped group reads as not covered', () => {
  const allSkipped = {
    ...result,
    findings: [],
    meta: { ...result.meta, findingCount: 0, ranChecks: [] },
    outcomes: [{ id: 'C14', priority: 1, status: 'skipped-missing-landmarks', missingLandmarks: ['request-assembly'], findingCount: 0, rejectionCount: 0, usage: u(0, 0) }],
  }
  assert.ok(renderMarkdown(allSkipped, en).includes('**Finite resources are accounted for** — not covered'))
})
t('json carries meta, findings, rejections, landmarks', () => {
  const parsed = JSON.parse(renderJson(result))
  assert.equal(parsed.meta.commit, 'abc1234')
  assert.equal(parsed.findings[0].direction, finding.direction)
  assert.equal(parsed.meta.evidenceRejections, 2)
  assert.equal(parsed.landmarks.length, 1)
})

// ---- report filenames ----
// A directory of identical `report-<timestamp>` names cannot be scanned; the
// dimensions belong in the name.
t('a single dimension names itself', () => assert.equal(fileScopeSuffix(['C1']), 'C1'))
t('a few dimensions are listed', () => assert.equal(fileScopeSuffix(['C1', 'C9']), 'C1-C9'))
t('three is still listed', () => assert.equal(fileScopeSuffix(['C1', 'C9', 'C14']), 'C1-C9-C14'))
t('ids sort numerically, not lexically', () => {
  // 'C10' < 'C9' as strings; the filename must not claim C10 came first.
  assert.equal(fileScopeSuffix(['C10', 'C9']), 'C9-C10')
})
t('many dimensions collapse to a count', () => {
  assert.equal(fileScopeSuffix(['C1', 'C2', 'C3', 'C4']), '4checks')
  assert.equal(fileScopeSuffix(Array.from({ length: 15 }, (_, i) => `C${i + 1}`)), '15checks')
})
t('an empty selection is still a legal name', () => assert.equal(fileScopeSuffix([]), 'none'))
t('every suffix is path-safe', () => {
  for (const ids of [['C1'], ['C1', 'C9'], ['C1', 'C2', 'C3', 'C4'], []]) {
    assert.ok(/^[A-Za-z0-9-]+$/u.test(fileScopeSuffix(ids)), fileScopeSuffix(ids))
  }
})

// ---- local time ----
// The filename previously carried the UTC instant, so a run at 20:43 local
// was named ...T12-43-49-845Z. Timezone-agnostic assertions: the test must
// pass wherever it runs, so it checks the relationship, not a literal.
t('the stamp is local, not UTC', () => {
  const iso = '2026-08-14T12:43:49.845Z'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  const stamp = localStamp(iso)
  assert.equal(stamp.slice(0, 10), `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
  assert.equal(stamp.slice(11, 13), p(d.getHours()), 'hour is not the local hour')
})
t('the stamp claims neither T nor Z', () => {
  // Those spellings mean UTC; this value is not UTC.
  const stamp = localStamp('2026-08-14T12:43:49.845Z')
  assert.ok(!stamp.includes('Z') && !stamp.includes('T'), stamp)
})
t('the stamp is path-safe and sorts chronologically', () => {
  const a = localStamp('2026-08-14T12:00:00.000Z')
  const b = localStamp('2026-08-14T13:00:00.000Z')
  assert.ok(/^[0-9_-]+$/u.test(a), a)
  assert.ok(a < b, `${a} should sort before ${b}`)
})
t('the displayed time states its offset', () => {
  // A local clock reading is unreconcilable with the ISO instant beside it in
  // the JSON unless the offset that produced it is printed too.
  const shown = localDisplay('2026-08-14T12:43:49.845Z')
  assert.ok(/\(UTC[+-]\d\d:\d\d\)$/u.test(shown), shown)
})
t('the report says when it ran', () => {
  // Before this the document carried only a duration, so nothing in it said
  // when it was produced.
  assert.ok(/- Run at: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d \(UTC[+-]\d\d:\d\d\)/u.test(md), md.slice(md.indexOf('- Run at:'), md.indexOf('- Run at:') + 60))
})
t('the JSON keeps the unambiguous ISO instant', () => {
  // The filename is for humans; the machine record must stay UTC.
  assert.equal(JSON.parse(renderJson(result)).meta.startedAt, '2026-08-14T00:00:00.000Z')
})

export default state
