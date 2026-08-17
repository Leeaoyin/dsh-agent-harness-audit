/**
 * Test entry point: `node tests/run.mjs` (or `npm test`).
 *
 * Requires the peer dependencies to be installed, since the modules under
 * test import `@deepseek-ai/dsh-tools`.
 */
import { report } from './helpers.mjs'

const states = []
for (const mod of ['./criteria.test.mjs', './evidence.test.mjs', './render.test.mjs', './command-args.test.mjs', './prompt.test.mjs', './scope.test.mjs', './config.test.mjs', './picker.test.mjs', './i18n.test.mjs']) {
  states.push((await import(mod)).default)
}

process.exitCode = report(states) === 0 ? 0 : 1
