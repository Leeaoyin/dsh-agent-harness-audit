/**
 * The dimension picker's option list.
 *
 * Ordering is load-bearing: an earlier version floated P1 checks to the top,
 * which made the ids read C1, C4, C9, C10, C2 … and left anyone scanning for
 * a number unable to find it.
 */
import assert from 'node:assert/strict'
import { suite } from './helpers.mjs'
import { buildOptions } from '../src/picker.ts'
import { messages } from '../src/i18n.ts'
import { CHECKS } from '../src/checks.ts'

const { t, state } = suite('picker')

const numberOf = (label) => Number.parseInt(/^C(\d+)/u.exec(label)[1], 10)

for (const lang of ['en', 'zh']) {
  const options = buildOptions(messages(lang))

  t(`${lang}: one option per check`, () => {
    assert.equal(options.length, CHECKS.length)
  })

  t(`${lang}: ids ascend C1..C15 with no reordering`, () => {
    const numbers = options.map((o) => numberOf(o.label))
    assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), 'options are not in id order')
    assert.deepEqual(numbers, CHECKS.map((c) => numberOf(`${c.id} ·`)), 'options diverge from the check table order')
  })

  t(`${lang}: every option carries a non-empty description`, () => {
    for (const o of options) assert.ok(o.description.length > 0, o.label)
  })

  t(`${lang}: the description is the plain-language gloss, not the group`, () => {
    const gloss = messages(lang).checkGloss
    for (const o of options) {
      assert.equal(o.description, gloss[/^(C\d+)/u.exec(o.label)[1]])
    }
  })

  t(`${lang}: critical checks are marked in the label`, () => {
    const marker = messages(lang).pickP1Suffix
    for (const check of CHECKS) {
      const option = options.find((o) => o.label.startsWith(`${check.id} ·`))
      assert.equal(option.label.endsWith(marker), check.priority === 1, check.id)
    }
  })

  t(`${lang}: every label starts with a parseable id`, () => {
    // The answer echoes labels back; a label the id parser cannot read would
    // silently drop that dimension from the selection.
    for (const o of options) assert.ok(/^C\d{1,2}\s·/u.test(o.label), o.label)
  })
}

export default state
