/**
 * Report rendering. The assertions here are mostly about honesty properties:
 * a skipped check must never read as a clean one, and a suspected verdict must
 * not present as confirmed.
 */
import assert from 'node:assert/strict'
import { suite } from './helpers.mjs'
import { renderMarkdown, renderJson } from '../src/render.ts'

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
    skill: { provider: 'runtime', source: 'bundled', overridden: false },
    skillName: 'harness-evaluation', subagentProvider: 'spawn', concurrency: 1,
    maxTokensPerCheckAdvisory: 120000, requestedChecks: ['C13', 'C14'], ranChecks: ['C14'],
    skippedChecks: ['C13'], unknownChecks: [], reconUsage: u(80, 12), totalUsage: u(120, 34),
    evidenceRejections: 2, rejectionsByReason: { 'evidence-not-found': 2 },
    findingCount: 1, landmarkCount: 1, lspAvailable: false,
  },
  run: { landmarks: [{ kind: 'request-assembly', file: 'src/req.ts', line: 12, symbol: 'build', confidence: 'high' }] },
  findings: [finding],
  outcomes: [
    { id: 'C13', priority: 1, status: 'skipped-missing-landmarks', missingLandmarks: ['truncation'], findingCount: 0, rejectionCount: 0, usage: u(0, 0) },
    { id: 'C14', priority: 1, status: 'ran', missingLandmarks: [], findingCount: 1, rejectionCount: 2, usage: u(40, 22) },
  ],
}

const md = renderMarkdown(result)

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
t('criteria provenance recorded', () => assert.ok(md.includes('provider `runtime`')))
t('landmarks rendered', () => assert.ok(md.includes('request-assembly')))

t('evidence cannot break out of its fence', () => {
  const evil = { ...result, findings: [{ ...finding, evidence: '```\n## Injected heading' }] }
  assert.ok(!renderMarkdown(evil).includes('\n```\n## Injected heading'))
})
t('not-implemented gets its own section', () => {
  const ni = { ...result, findings: [{ ...finding, verdict: 'not-implemented', confirmHint: undefined }] }
  const out = renderMarkdown(ni)
  assert.ok(out.includes('## Not implemented') && out.includes('That is not a pass.'))
})
t('zero findings still renders every mandatory section', () => {
  const empty = { ...result, findings: [], meta: { ...result.meta, findingCount: 0 } }
  const out = renderMarkdown(empty)
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
  assert.ok(renderMarkdown(allSkipped).includes('**Finite resources are accounted for** — not covered'))
})
t('json carries meta, findings, rejections, landmarks', () => {
  const parsed = JSON.parse(renderJson(result))
  assert.equal(parsed.meta.commit, 'abc1234')
  assert.equal(parsed.findings[0].direction, finding.direction)
  assert.equal(parsed.meta.evidenceRejections, 2)
  assert.equal(parsed.landmarks.length, 1)
})

export default state
