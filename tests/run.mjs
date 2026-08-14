/**
 * Test entry point: `node tests/run.mjs` (or `npm test`).
 *
 * Requires the peer dependencies to be installed, since the modules under
 * test import `@deepseek-ai/dsh-tools`.
 */
import { report } from './helpers.mjs'

const states = []
for (const mod of ['./skill-agreement.test.mjs', './evidence.test.mjs', './render.test.mjs']) {
  states.push((await import(mod)).default)
}

process.exitCode = report(states) === 0 ? 0 : 1
