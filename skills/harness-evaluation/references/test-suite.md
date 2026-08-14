# Building the deterministic test layer

Read this before writing any test infrastructure. The scripted model section
is the important one — the obvious design fails in a way that is not obvious
until you have built it.

## Contents

1. Finding → test mapping (start here)
2. The scripted model
3. Fake tools
4. Fault injection
5. Oracles
6. Directory layout

---

## 1. Finding → test mapping

Build tests for defects the audit actually found, in the order it ranked
them. Each row below is a small, deterministic test — none of them needs a
real model or a real network.

| Finding | Test | Assertion |
|---|---|---|
| C1 pairing | Tool throws on the Nth call | Every emitted call has exactly one result in the transcript |
| C1 parallel | One of N parallel tools throws | N results present; N−1 successful |
| C3 recovery | Kill the process between the two halves of a checkpoint write | Restart detects incomplete state; no operation re-executes |
| C4 parsing | Scripted model emits invalid JSON arguments | Classified error, loop survives |
| C4 stream | Cut the stream mid-frame | Partial state discarded, not committed |
| C5 paths | Tool argument contains traversal and a symlink to outside | Rejected before the filesystem call |
| C9 idempotency | Side-effecting tool commits, then times out; retry follows | Effect count is exactly 1 |
| C10 cancel | Cancel while a subprocess and a request are in flight | No surviving processes; no further writes after the cancel point |
| C11 timeouts | Tool sleeps past the tool budget but under the backstop | Error is the tool-level timeout, not a transport error |
| C12 loops | Scripted model emits the same call forever | Terminates at the ceiling with a distinct status |
| C13 truncation | Drive the session past the context limit | No cut separates a call from its result |
| C14 prefix | Build the request twice from identical state | Serialized prefixes are byte-identical |

The C14 test costs almost nothing and catches an entire class of silent cost
regressions. Write it even if the audit found nothing.

---

## 2. The scripted model

### The problem with the obvious design

A harness sends arbitrary prompts, assembled from the system prompt, tool
definitions, history, and whatever the tools returned. You cannot write a
stub that responds *sensibly* to arbitrary input — that would require a
model.

The resolution is to stop trying. **These tests assert on harness behaviour,
not on model reasoning.** The stub does not need to be sensible; it needs to
be controllable.

### Design A: turn-indexed script (the workhorse)

The stub ignores the prompt entirely and returns the Nth entry of a
predetermined list on the Nth call.

```
turn 0 → tool call: read_file{path: "a.txt"}
turn 1 → tool call: write_file{path: "b.txt", content: "x"}
turn 2 → text: "done"
```

Covers most tests. Deterministic, no recording step, trivially readable.
Its weakness is that it breaks whenever the harness changes how many requests
it makes per logical turn — which happens more often than you'd expect.
Mitigation: assert on the transcript, not on the turn count, and let the
script run past its end by returning a terminal response.

### Design B: rule-matched responses

A small table of predicates over the last message, with a default fallback.

```
if last message contains tool result for "read_file" → emit write_file call
if last message contains tool result for "write_file" → emit "done"
default → emit "done"
```

More robust to changes in request structure. Use it for tests that span many
turns, where turn indices become fragile.

### Design C: record and replay

Record real interactions once; replay from a keyed cache thereafter. Highest
fidelity, and the only option when the test depends on realistic model
output.

Three rules that make the difference between this working and this being a
permanent source of pain:

**Normalize the cache key.** Key on a canonicalized request: strip
timestamps, sort tool definitions, drop generated ids. Without this, the
cache misses on every run and you have built an expensive live test.

**Never fall back to the live provider on a miss.** Fail the test with a
message naming the re-record command. A silent fallback turns a deterministic
suite into a flaky, billable one, and the failure mode is invisible — the
suite still passes, just slowly and expensively.

**Store recordings as raw frames, not as parsed objects.** See below.

### The constraint that shapes all three

The scripted model is where you inject malformed output — invalid JSON
arguments, duplicate call ids, truncated streams, unexpected fields. That
means it **cannot be built on the provider SDK's typed response objects**,
because those types make invalid output unrepresentable. It must emit raw
bytes or raw stream frames at the transport boundary.

Design for this from the start. Retrofitting a raw-frame path into a stub
built on typed objects means rewriting it.

### Placement

Substitute at the narrowest seam that still lets you inject transport-level
malformation — usually the HTTP client or the provider adapter interface,
not the "call the model" helper three layers up. Substituting too high skips
the stream parsing code, which is exactly what C4 tests.

---

## 3. Fake tools

Fake tools need to be able to:

- succeed;
- fail with a classified error;
- fail with an unclassified exception;
- hang past every timeout layer;
- return output far larger than the context window;
- return malformed output;
- **commit a side effect and then fail** (the C9 case);
- count their own invocations, so tests can assert effect counts.

That last pair is the point. A fake tool that can only succeed or fail
cleanly cannot test the interesting half of the space.

Keep the effect counter outside the tool instance so it survives whatever the
harness does to the tool between retries.

---

## 4. Fault injection

Each scenario declares what is injected, when, and what outcomes are
acceptable. A schema like this works:

```yaml
scenario: side-effect-commits-then-times-out
fault:
  target: <tool or seam name>
  phase: after_side_effect     # before_call | during | after_side_effect | on_response
  occurrence: 1                # which invocation
  error: timeout
expect:
  max_side_effect_count: 1
  allowed_status: [SUCCESS, NEEDS_REVIEW]
  forbidden: [DUPLICATE_EFFECT]
```

`phase: after_side_effect` is the valuable one. It is the only way to test
the unknown-outcome case, and unknown outcome is where duplicate side effects
come from.

**Injection points worth wiring:** provider transport (status codes, stream
cut, malformed body), tool boundary, filesystem (permission denied, disk
full, file changed between read and write), subprocess (hang, non-UTF-8
output, exit code inconsistent with output), persistence (write fails, crash
between the two halves of a bracketed write), clock (jump forward to trip
timeouts without real waiting).

**Verify zero-injection first.** Run the whole suite with every injector
disabled and require it green. Injectors change timing; without this
baseline, you cannot tell a real defect from one the injector caused.

---

## 5. Oracles

Do not assert on final text alone. Final text is the least reliable signal
the system produces.

**State oracle.** Assert on the world: files on disk, records in the store,
external service state. Keep the interface generic — the oracle should accept
a comparable snapshot, not know what a domain object is. Domain assertions
belong in the test case, not in the oracle.

**Trace oracle.** Assert on the execution record: which tools ran, in what
order, how many times, how many retries, where it stopped. This is where most
harness defects are visible, because a harness defect usually shows up as a
wrong *sequence* with a plausible-looking final answer.

**Invariant oracle.** A fixed set of relations that must hold after *every*
scenario, checked automatically rather than per-test:

- every tool call has exactly one result;
- side-effect count equals the number of intended effects;
- no unauthorized operation executed;
- no cross-tenant access, if the harness is multi-tenant;
- recovered state equals the state normal execution would have reached;
- no process, timer, or connection survives shutdown.

Running these after every scenario is how one test catches a defect a
different test was written for.

---

## 6. Directory layout

```
harness-eval/
├── scenarios/          # declarative scenario files
├── scripted-model/     # stub provider (raw-frame capable)
├── fake-tools/
├── injector/
├── oracles/
│   ├── state
│   ├── trace
│   └── invariants      # run after every scenario
├── replay/             # recordings + normalized keying
└── report/
```

Build it in this order: fake tools and scripted model, then one scenario end
to end, then the invariant oracle, then the injector, then the rest. A single
working scenario teaches you more about the shape of the seams than any
amount of upfront structure.
