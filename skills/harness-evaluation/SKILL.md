---
name: harness-evaluation
description: >
  Audit an AI agent harness (the execution framework around the model — agent
  loop, tool execution, state management, context management, retry, recovery,
  permissions, observability) for robustness, safety, and recoverability. Also
  designs deterministic reliability test suites for such harnesses. Use this
  whenever someone asks you to review, audit, harden, or write tests for an
  agent framework, agent runtime, agent loop, tool-calling layer, or
  "harness" — and also when they describe symptoms of harness fragility
  without naming it: orphaned tool calls, 400s from the provider on the next
  turn, runs that won't cancel, duplicated side effects after a retry, state
  corruption after a crash, infinite tool loops, or prompt cache that never
  hits. This skill evaluates the framework, NOT whether the model is smart
  enough to solve a task — do not use it for model or prompt quality
  evaluation.
---

# Agent Harness Evaluation

## What this evaluates

The execution framework around the model. Not the model.

The question this skill answers is not "did the task succeed" but:

- When something goes wrong, does it fail **safely**?
- Is the state afterwards **consistent and recoverable**?
- Are side effects **bounded** — never duplicated, never unauthorized?
- Can you **reconstruct** what happened, and **replay** it?

A harness that succeeds on the happy path and corrupts state on every third
failure is worse than one that succeeds less often and always fails cleanly.
Grade accordingly.

## Two modes

Decide which mode applies before doing anything else. If the request is
ambiguous, ask — the two produce completely different artifacts.

**Mode A — Audit.** The user has a harness codebase and wants to know what's
weak. Output is a findings report with code locations. Takes minutes. No
infrastructure required. **This is the default** — start here even when the
user eventually wants tests, because the audit tells you which tests are
worth writing.

**Mode B — Build tests.** The user wants a reliability test suite. Output is
code: scripted model, fake tools, fault injector, oracles, CI wiring. Read
`references/test-suite.md` and `references/ci-and-metrics.md` before writing
any of it — there are non-obvious traps, especially in the scripted model.

Most real requests are A then B: audit, then write tests for the specific
weaknesses the audit found. Do not build a generic test suite for problems
the codebase doesn't have.

---

# Mode A: Audit workflow

## Step 1 — Locate landmarks

Before checking anything, find where things live. Record file and line for
each. Missing landmarks are a normal result, not a failure — they mean the
corresponding checks report "not implemented" rather than "passed".

| Landmark | What to look for |
|---|---|
| agent loop | the function that iterates turns until done |
| request assembly | where the provider request body is built |
| system prompt build | where the system prompt string is composed |
| tool registry | where tool definitions are collected and serialized |
| tool execution | where a tool call is dispatched and its result captured |
| history append | where messages are added to the conversation |
| stream parse | where the provider response stream is decoded |
| retry | any retry loop or decorator |
| truncation | compaction, summarization, or sliding window |
| process spawn | every subprocess launch |
| http call | every outbound request |

Use symbol-level navigation (go-to-definition, find-references) where
available; fall back to text search. Search-based location is fine, but
verify by reading the surrounding function — a grep hit is a candidate, not
a landmark.

## Step 2 — Run the checks

Fourteen checks below, grouped by the property they protect. Work through
them in priority order. If context or time is limited, P1 alone is a useful
audit; P1+P2 is a good one.

For each check, produce zero or more findings. **A finding without a file and
line number is not a finding — drop it.** See "Evidence rules" below.

## Step 3 — Report

Use the report template at the end of this document. Include the
"Not covered" section — it is not optional.

---

# The checks

Priority: **P1** = fails loudly and often, judgment is nearly mechanical.
**P2** = real production risk, needs more reading. **P3** = matters at scale
or in specific deployments.

## Group 1 — State stays self-consistent

### C1 · Tool-call pairing completeness — P1

**Symptom.** A tool call is emitted but no matching result is recorded on
some exit path. The next request carries an unclosed call and the provider
rejects it (usually 400). Highest-frequency real failure in agent harnesses.

**Check.** Walk every path that can exit tool execution: normal return,
`catch`, timeout, cancellation, early return, permission denial. Each must
write a result. Then check parallel dispatch: if one call fails, are the
others' results still recorded? `Promise.all` and equivalents reject on
first failure and discard the settled results — that breaks both this check
and C8.

**Confirmed when** a reachable exit path writes no result, or parallel
dispatch uses all-or-nothing semantics.

**Invariant it protects.** Every tool call has exactly one result.

### C2 · History is append-only — P2

**Symptom.** Messages are mutated after being added — a field backfilled, an
assistant message corrected in place, an id rewritten. Breaks replay, breaks
debugging, and silently invalidates every cached prefix from the mutation
point onward.

**Check.** Look for assignment into elements of the message array, or
functions that take a message and return a modified copy that replaces the
original. Legitimate exception: an explicit, isolated compaction step that
replaces a range — that is C11's territory, not a violation here.

**Confirmed when** message objects already in history are mutated outside a
declared compaction path.

### C3 · Crash and checkpoint semantics — P2

**Symptom.** The process dies mid-write. On restart the partial state is
indistinguishable from a complete one, so the harness resumes on top of a
half-written checkpoint.

**Check.** Find the persistence writes. For each multi-part write (a "start"
record and an "end" record, or a header and a body), ask what a reader sees
if the process dies between them. Good designs leave a **detectable
incomplete marker**; bad ones leave something that reads as complete.
Also check: does resume re-execute anything that already ran?

**Confirmed when** a partial write is indistinguishable from a complete one,
or resume re-executes a side-effecting operation.

**Invariant it protects.** Recovered state equals the state normal execution
would have reached.

## Group 2 — Untrusted input is treated as untrusted

### C4 · Model output parsing — P1

**Symptom.** Malformed tool arguments, a truncated stream, or a repeated call
id crashes the loop or produces silent garbage. Malformed model output is
routine, not exceptional.

**Check.**
1. Bare deserialization of model-produced JSON with no error handling.
2. Stream terminated early: is partially accumulated state discarded, or
   committed as if complete?
3. Duplicate tool-call id in one turn.
4. Delta accumulation assuming indices are contiguous, zero-based, or
   monotonic.

**Confirmed when** model output is deserialized without error handling, or
partial stream state is committed on early termination.

### C5 · Path and sandbox boundaries — P2

**Symptom.** A model-supplied path escapes the workspace.

**Check.** Path joining without a subsequent resolve-and-prefix check. Prefix
checks performed before symlink resolution (the resolved target can point
outside). Also check whether the check happens on the same string that is
later opened — validating one variable and opening another is a common bug.

**Confirmed when** a model-supplied path reaches a filesystem call without
resolve-then-prefix validation.

### C6 · Secrets and ambient environment — P2

**Symptom.** The whole process environment is handed to model-generated
commands, so every credential in it is one `env` away from the transcript.

**Check.** Subprocess launches that pass the full environment (explicitly, or
by not specifying one and inheriting). Predictable paths handed to untrusted
output. Whether tool output is scanned for secrets before entering history.

**Confirmed when** subprocess launch inherits the full environment for
model-generated commands.

## Group 3 — Failure is a first-class outcome

### C7 · Error taxonomy and retryability — P2

**Symptom.** Callers receive a bare error and cannot decide what to do, so
they either retry everything or give up on everything.

**Check.** Is there a closed set of error codes a caller can enumerate? Is
each failure classified as retryable / not retryable / fatal? Or does a raw
provider exception propagate to the loop?

**Confirmed when** failures reach the agent loop without classification.

**Good shape for reference.** A small closed enum per subsystem, so callers
can switch on it exhaustively.

### C8 · Partial success — P2

**Symptom.** Four of five parallel operations succeeded, but the batch is
reported as a single failure and the four results are discarded.

**Check.** Any place where multiple independent outcomes collapse into one
status. Look for all-or-nothing combinators over independent work.

**Confirmed when** independent results are discarded because a sibling
failed.

### C9 · Idempotency and side-effect safety — P1

**Symptom.** An operation with an external effect times out *after* the
effect committed. The harness retries. The effect happens twice.

**Check.** What does the retry wrapper actually enclose? If the retried
region contains a write, a command execution, or an outbound message, retry
duplicates it. Safe designs retry only the transport, or carry an
idempotency key, or query-before-retry when the outcome is unknown.

The hard case to look for specifically: **timeout after commit**. Unknown
outcome is not the same as failure, and must not be treated as one.

**Confirmed when** a retried region contains a side-effecting operation with
no idempotency key and no query-before-retry.

**Invariant it protects.** Duplicate side effects = 0. Treat any violation as
release-blocking.

## Group 4 — Boundaries can be closed

### C10 · Cancellation propagation — P1

**Symptom.** The user cancels; the subprocess keeps running, the request
keeps waiting, the timer keeps firing. Symptom is "it won't stop".

**Check.**
1. Is the cancellation signal actually passed to outbound requests, or
   created and then forgotten?
2. After spawning a process, is a kill registered on cancellation? Does it
   kill the **process group** — killing only the direct child leaves
   shell-spawned grandchildren behind.
3. Are timers cleared on error paths, not just success paths?
4. On cancellation, does stream consumption stop, or run to EOF?
5. Does shutdown reach genuine quiescence, or merely *request* that
   everything stop and return immediately?

**Confirmed when** a spawn has no kill registration, or a request is issued
without the available cancellation signal.

### C11 · Timeout layering — P2

**Symptom.** Users always see a low-level connection error, never a
meaningful "this tool timed out", so nobody can tell which tool is slow.

**Check.** Count the timeout layers on one tool call and compare the numbers.
The healthy relationship is **tool-level budget < underlying resource
backstop**, so the normal timeout surfaces as a classified tool timeout. One
layer only, or an inner backstop shorter than the outer budget, is the
problem.

**Confirmed when** the inner backstop is shorter than the outer tool budget.

### C12 · Loop and budget limits — P1

**Symptom.** The model calls the same tool forever. Cost climbs until someone
notices.

**Check.** Are there hard ceilings on turns, tool calls, wall-clock runtime,
tokens, and — if the harness supports delegation — depth and fan-out of
sub-agents? Is there any no-progress detection (identical call repeated with
identical arguments)? When a ceiling is hit, is the outcome a distinct
status, or does it look like normal completion?

**Confirmed when** any of turns / tool calls / runtime has no ceiling, or a
ceiling produces a status indistinguishable from success.

## Group 5 — Finite resources are accounted for

### C13 · Context management and truncation boundaries — P1

**Symptom.** Long sessions hit the context limit and the harness either dies
or truncates across a tool-call boundary, producing exactly the C1 failure.

**Check.**
1. Is there any context management at all — compaction, summarization,
   sliding window? If not, the ceiling is a hard wall; report that.
2. Where is the cut chosen? If purely by token count or message count with
   no pairing validation, the cut can separate a tool call from its result.
3. What happens if the content is still too large after compaction? Is there
   a second path, or does it loop?
4. Are oversized tool outputs spilled to storage and replaced by a reference,
   or pushed whole into context?

**Confirmed when** the cut point is selected without tool-pairing validation,
or there is no path for "still too large after compaction".

**Reported as not-implemented** when no context management exists — with an
explicit note that this is a hard ceiling, not a passing grade.

### C14 · Prompt prefix determinism — P1

**Symptom.** The provider's prefix cache never hits. Nothing errors. Nothing
is functionally wrong. Every request is billed at full input price. Because
there is no failure signal, this survives in production for months.

**Check.** On the path that builds everything before the newest user
message — system prompt, tool definitions, prior messages:

1. Non-deterministic values: current time, timestamps, random numbers,
   generated ids, process id, hostname. Any of these in the prefix changes it
   every request.
2. Tool ordering that depends on iteration over a runtime-populated map or
   set without an explicit sort.
3. Volatile content placed at the front rather than the back — current
   directory listing, "today's date", live status — when it could live in the
   trailing message instead.
4. In-place history mutation (see C2), which invalidates from the mutation
   point onward.

**Confirmed when** a non-deterministic value appears on the prefix
construction path.

**How to verify empirically.** Build the request twice for the same
conversation state and compare the serialized prefix byte for byte. Any
difference is a defect. This is cheap and worth adding as a permanent test.

**Note on framing.** This is a robustness property, not an optimization. A
harness whose cost is several times higher than it needs to be, with no
signal that anything is wrong, is failing — just slowly.

## Group 6 — The run is observable

### C15 · Trace completeness and replay — P2

**Symptom.** Something went wrong in production and nobody can reconstruct
what happened, so no fix can be validated.

**Check.** Is there an event record covering turn boundaries, tool calls and
results, request composition, retries, truncation, and approvals? Is token
usage recorded, including cache read/write? Can a recorded run be replayed
without calling the provider?

**Confirmed when** tool calls and their results are not recorded with
correlation between them, or token usage is not recorded at all.

**Why this is last but not least.** Without it, none of the other thirteen
can be verified after a change. If the user has to fix one thing before all
others, and they have no traces, this is it.

---

# Evidence rules

These exist because a report full of plausible-sounding findings with no
locations is worse than no report — it costs the reader more to verify than
to audit themselves, and they stop trusting the tool.

**Every finding carries a file path, a line number, and a verbatim code
excerpt** that a reader can check in under a minute. No location, no finding.

**Three verdicts, and use them honestly:**

| Verdict | Meaning |
|---|---|
| `confirmed` | Evidence directly supports the claim. |
| `suspected` | A protection is structurally absent, but you could not confirm the path is reachable. State exactly what a human should check. |
| `not-implemented` | The subsystem doesn't exist here. Not a pass. |

**Do not upgrade on the way to the summary.** If a finding is `suspected` in
the body it stays `suspected` in the summary. This is the single most common
way this kind of report loses credibility.

**Do not pad.** Zero findings in a group is a fine result and should be
reported plainly. Inventing marginal findings to make each group non-empty
destroys the signal.

**Say what you didn't cover.** If a landmark wasn't found, or the codebase
was too large to read fully, the affected checks go in "Not covered". A
reader must be able to distinguish "checked, clean" from "never looked".

---

# Report template

```markdown
# Harness robustness audit

Target: <path> @ <commit>
Checks run: <n>    Findings: <n> confirmed / <n> suspected

## Summary
One line per check group, with its highest verdict.

## Confirmed

### C<n> · <check name>
**<file>:<line>**
<one sentence: what is wrong>

<verbatim code excerpt>

Consequence: <what breaks, concretely, and under what conditions>
Direction: <what a fix looks like — not a patch>

## Suspected
Same shape, plus: "To confirm, check <specific thing>."

## Not covered
Which checks could not be evaluated, and why.

## Cost
Tokens consumed by this audit.
```

Report cost. The reader needs it to decide whether to run this regularly.

---

# After the audit

Findings are worth little without regression protection — the same defect
reappears in three months. For each confirmed finding, the corresponding test
is usually small and deterministic.

Map from finding to test in `references/test-suite.md`. Build tests for the
defects that were actually found, in the order the audit ranked them. Do not
stand up the full test infrastructure first; that ordering has killed more of
these efforts than any technical problem.

---

# Reference files

Read these only when you need them — they are not required for Mode A.

- `references/test-suite.md` — building the deterministic test layer:
  scripted model (read this before writing one; the obvious design does not
  work), fake tools, fault injection, oracle design, finding→test mapping.
- `references/ci-and-metrics.md` — the three pipelines, metric definitions
  with default thresholds, flake policy, cost control.
- `references/search-patterns.md` — language-specific search patterns for
  each check. TypeScript/JavaScript, Python, Go.
