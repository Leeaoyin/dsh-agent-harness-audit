/**
 * The plugin's check table must agree with the skill it orchestrates.
 *
 * This is the test that matters most over time: the criteria live in markdown
 * and are expected to change, and nothing else would notice a check being
 * renamed, re-prioritised, regrouped, or added.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { suite } from './helpers.mjs'
import { parseFrontmatter, bundledSkillDir } from '../src/skill.ts'
import { CHECKS, CHECK_BY_ID, GROUPS, LANDMARK_KINDS } from '../src/checks.ts'

const { t, state } = suite('skill agreement')

const skillDir = bundledSkillDir()
const raw = readFileSync(`${skillDir}SKILL.md`, 'utf8')
const fm = parseFrontmatter(raw)

t('bundled skill directory resolves', () => {
  assert.ok(skillDir.replace(/\\/gu, '/').endsWith('/skills/harness-evaluation/'))
})

t('name parses', () => assert.equal(fm.name, 'harness-evaluation'))

t('folded block scalar does not leak its ">" indicator', () => {
  assert.ok(!fm.description.startsWith('>'), fm.description.slice(0, 40))
  assert.ok(fm.description.length > 300)
})

t('body excludes frontmatter', () => {
  assert.ok(!fm.body.includes('description:'))
  assert.ok(fm.body.trimStart().startsWith('#'))
})

const headings = [...raw.matchAll(/^### (C\d+) · ([^\n—]+?) — (P[12])$/gmu)]

t('skill declares exactly the checks the plugin knows', () => {
  assert.equal(headings.length, CHECKS.length, `skill ${headings.length} vs plugin ${CHECKS.length}`)
  assert.deepEqual(headings.map((m) => m[1]), CHECKS.map((c) => c.id))
})

t('check names match verbatim', () => {
  for (const m of headings) {
    assert.equal(CHECK_BY_ID.get(m[1]).name, m[2].trim(), m[1])
  }
})

t('priorities match', () => {
  for (const m of headings) {
    assert.equal(`P${CHECK_BY_ID.get(m[1]).priority}`, m[3], m[1])
  }
})

t('group headings match', () => {
  const groups = [...raw.matchAll(/^## Group \d+ — (.+)$/gmu)].map((m) => m[1].trim())
  assert.deepEqual(groups, [...GROUPS])
})

t('every check belongs to a declared group', () => {
  for (const c of CHECKS) assert.ok(GROUPS.includes(c.group), `${c.id} -> ${c.group}`)
})

t('landmark kinds cover the skill Step 1 table', () => {
  const section = raw.slice(raw.indexOf('## Step 1'), raw.indexOf('## Step 2'))
  const rows = [...section.matchAll(/^\| ([a-z ]+) \| /gmu)]
    .map((m) => m[1].trim().replace(/ /gu, '-'))
    .filter((r) => r !== 'Landmark')
  assert.deepEqual(rows.sort(), [...LANDMARK_KINDS].sort())
})

t('reference documents exist', () => {
  for (const f of ['test-suite.md', 'ci-and-metrics.md', 'search-patterns.md']) {
    readFileSync(`${skillDir}references/${f}`, 'utf8')
  }
})

// ---- frontmatter parser edge cases ----
t('literal block scalar', () => {
  assert.equal(parseFrontmatter('---\nname: x\ndescription: |\n  one\n  two\n---\n').description, 'one two')
})
t('chomped block scalar', () => {
  assert.equal(parseFrontmatter('---\nname: x\ndescription: >-\n  one\n---\n').description, 'one')
})
t('inline scalar', () => {
  assert.equal(parseFrontmatter('---\nname: x\ndescription: hi there\n---\n').description, 'hi there')
})
t('quoted scalar is unquoted', () => {
  assert.equal(parseFrontmatter('---\nname: x\ndescription: "hi"\n---\n').description, 'hi')
})
t('missing description is rejected', () => {
  assert.throws(() => parseFrontmatter('---\nname: x\n---\n'), /requires `description`/u)
})
t('missing fence is rejected', () => {
  assert.throws(() => parseFrontmatter('# nope'), /opening/u)
})

export default state
