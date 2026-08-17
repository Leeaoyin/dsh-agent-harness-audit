/** Configuration defaults and the constraints the schema is meant to enforce. */
import assert from 'node:assert/strict'
import { suite } from './helpers.mjs'
import { Config } from '../src/config.ts'

const { t, state } = suite('config')

const d = new Config({})

t('defaults are complete', () => {
  assert.equal(d.priorityFloor, 2)
  assert.equal(d.concurrency, 3)
  assert.equal(d.subagentProvider, 'spawn')
  assert.equal(d.outputDir, '.harness-audit')
  assert.deepEqual(d.checks, [])
})

t('background defaults on', () => assert.equal(d.background, true))
t('background can be turned off', () => assert.equal(new Config({ background: false }).background, false))
t('announceOnStart defaults on', () => assert.equal(d.announceOnStart, true))
t('announceOnStart can be turned off', () => assert.equal(new Config({ announceOnStart: false }).announceOnStart, false))
t('useLsp defaults on', () => assert.equal(d.useLsp, true))
t('crossCheckAnalysis defaults off', () => assert.equal(d.crossCheckAnalysis, false))

// concurrency 1 is the cheapest debugging path and must stay valid
t('concurrency 1 is accepted', () => assert.equal(new Config({ concurrency: 1 }).concurrency, 1))
t('concurrency 0 is rejected', () => assert.throws(() => new Config({ concurrency: 0 })))
t('fractional concurrency is rejected', () => assert.throws(() => new Config({ concurrency: 1.5 })))

t('priorityFloor accepts 1 and 2 only', () => {
  assert.equal(new Config({ priorityFloor: 1 }).priorityFloor, 1)
  assert.throws(() => new Config({ priorityFloor: 3 }))
})

// With no configured default, an empty `checks` must mean "ask", never
// "audit everything by default" — the C14 default that silently redirected a
// run is exactly what removing this guards against.
t('checks defaults to empty so nothing is implicitly selected', () => {
  assert.deepEqual(d.checks, [])
})

t('an explicit check list is preserved', () => {
  assert.deepEqual(new Config({ checks: ['C1'] }).checks, ['C1'])
})


export default state
