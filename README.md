# dsh-harness-audit

Audits an agent harness against the criteria in the `harness-evaluation`
skill, and refuses findings whose evidence isn't actually in the code.

The plugin owns no judgment. Every criterion lives in the skill; the plugin
owns the command, the orchestration, the evidence validation, and a
deterministic summary. Changing what counts as a defect is a markdown edit,
not a release.

## Status

M1 and M2 are implemented: plugin load with a skill self-check, `/harness-audit`,
recon, single-check fan-out, `report_finding` with evidence validation, and
both report files. The check table carries all of C1–C15, so widening coverage
is a configuration change.

**Not yet done:** the M2 acceptance step. Nothing here has been run against a
real codebase, because that needs a live harness with the dependencies
installed. Until the false-positive rate and the evidence-rejection rate have
been measured by hand on a real target, the sensible setting is the one in
`cordis.yml` — `checks: ['C14']`, `concurrency: 1`. Widening before that
measurement just scales up whatever noise is there.

```bash
npm test --prefix dsh-harness-audit
```

67 tests cover evidence validation, deduplication, check selection, report
rendering, and — most importantly — that the plugin's check table still agrees
with the skill's ids, names, priorities, groups, and landmark kinds. That last
one is what catches criteria drift.

## Install

The criteria ship in `skills/harness-evaluation/` (SKILL.md plus three
reference documents). They must stay in `package.json`'s `files` list — the
plugin throws at load time if they are missing, because a silently absent
skill would make every audit return an empty report that reads like a clean
bill of health.

Development:

```bash
pnpm dsh web --patch ./dsh-harness-audit/cordis.yml
```

The path inside `cordis.yml` must be absolute — edit it to match your checkout.

Distribution is via npm or `pnpm pack`. A GitHub install would need users to
authorise a `prepare` build script, which permits this package's code to run
on their machine outside any agent sandbox; prefer the prebuilt paths.

## Use

```
/harness-audit
/harness-audit --checks C1,C9,C14
```

Two files land in `outputDir` (default `.harness-audit/`): a JSON record and a
Markdown report. The Markdown follows the skill's own report template, so a
hand-run audit and a plugin-run audit produce the same document.

## Overriding the criteria

The bundled skill registers at rank 250, so a project-level skill provider
outranks it. Drop your own `harness-evaluation` into a project skill root and
the plugin uses yours with no code change. Every report records which provider
actually supplied the criteria, so a bad result can be traced to the criteria
or to the orchestration rather than guessed at.

Because the criteria can be replaced, the check table stores only ids,
priorities, and landmark dependencies — never what a check means.

## How a run works

1. **Recon** — one subagent runs the skill's landmark-location step and reports
   through `report_landmark`.
2. **Fan-out** — one throwaway subagent per check, each told to run exactly one
   check and given only the landmarks that check depends on. A check whose
   required landmarks were not found is **not dispatched**; it is recorded as
   not covered. Running a check with no target is a leading source of false
   positives.
3. **Summary** — pure code. No model writes the summary: that is how
   `suspected` turns into `confirmed` and how unevidenced claims get in.

## Evidence validation

`report_finding` refuses a submission unless:

1. the check belongs to this run,
2. the file exists inside the workspace (this is also the path-traversal gate),
3. the line exists in that file,
4. **the quoted evidence actually appears within ±3 lines of the cited line**, and
5. a `suspected` verdict carries a `confirmHint`.

Rule 4 compares normalised text — trimmed, internal whitespace collapsed — not
bytes, so indentation differences don't cause spurious refusals.

**The rejection rate is the metric to watch.** It is recorded in every report.
A high rate means the subagents are fabricating and the prompts need work. It
is never a reason to relax validation.

## Cost

Every report states its token cost, per check and in total, so you can decide
whether the audit is worth running regularly.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `checks` | `[]` | Check ids to run; empty runs everything the priority floor admits. An explicitly named check runs regardless of the floor. |
| `priorityFloor` | `2` | Run checks at or below this priority (1 = P1 only). |
| `concurrency` | `3` | Checks in flight at once. `1` is supported and is the cheapest way to debug. |
| `subagentProvider` | `spawn` | Subagent provider name. |
| `maxTokensPerCheck` | `120000` | **Advisory.** See the limitation below. |
| `outputDir` | `.harness-audit` | Workspace-relative report directory. |
| `useLsp` | `true` | Try LSP navigation, degrading to text search. |
| `crossCheckAnalysis` | `false` | Reserved; not yet emitted. |
| `skillName` | `harness-evaluation` | Lets you point at a replacement skill. |

## Known limitations

- **`maxTokensPerCheck` is advisory.** The subagent seam has no whole-run token
  cap — `AgentOptions.maxTokens` bounds a single response, not a run — so the
  budget is stated to the subagent and recorded in metadata, and the report
  gives the observed cost. It is not enforced.
- **`crossCheckAnalysis` is not implemented.** The flag is accepted and
  defaults off. When built, its output must be a separate section marked as
  model inference that did not pass evidence validation.
- **LSP availability is per-extension.** The seam exposes no capability query,
  so availability is observed by running a query and routing on the thrown
  `LspError`. The probe therefore runs after recon, using the detected primary
  language, and its result speaks only for that language.
- **Token attribution needs a local subagent provider.** Cost is folded from
  the child's session events; a remote provider publishes no local child
  session, so its usage reads as zero.

## Deviations from the design document

- `Check` splits landmark dependencies into `requires` (AND-gated, short-circuits
  the check) and `context` (passed to the prompt when present). A strict AND
  over every related landmark would skip checks that are perfectly runnable
  from their primary anchor — C10 would need agent-loop *and* process-spawn
  *and* http-call to run at all.
- Adds `src/state.ts`. The two reporting tools register once at load but only
  mean anything during a run, so the run state needs a home both can reach.
- The primary language is an optional parameter on `report_landmark` rather
  than a third tool, keeping the two-tool surface the design specifies.
- `report_finding` takes a `direction` argument ("what a fix looks like — not a
  patch"), which the skill's report template requires but the design's tool
  schema omitted. It is optional: rejections should be about evidence
  integrity, not the completeness of advice.
- The renderer adds a "Not implemented" section. That verdict is in the skill's
  taxonomy but its template only shows Confirmed and Suspected, and a
  `not-implemented` finding must not be silently dropped.
- `toolFilter` on the start request scopes each audit child to
  `skill`/`read`/`grep`/`glob`/`report_finding` (+`lsp`). The design left this
  open pending a check of the subagent README; one-shot children do support it,
  gated on the provider's `toolFilter` capability. It narrows the child rather
  than hiding the tool from the main agent, so the run-id gate is kept as well.
