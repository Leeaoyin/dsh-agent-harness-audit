# Language-specific search patterns

Search hits are candidates, not findings. Always read the enclosing function
before recording anything — a `Promise.all` over independent reads is fine; a
`Promise.all` over tool dispatch is C1 and C8.

Ordered to match the checks in SKILL.md.

---

## C1 · Tool-call pairing

**TypeScript / JavaScript**
`Promise.all` · `Promise.allSettled` · `catch` blocks inside the tool
dispatch function · `return` statements before the result-append call ·
`AbortError` handling

**Python**
`asyncio.gather` (check `return_exceptions`) · `except` inside the dispatch
coroutine · `asyncio.CancelledError`

**Go**
`errgroup` (first error cancels the group) · early `return err` before the
append · `select` on `ctx.Done()`

Read the dispatch function end to end and enumerate exits. Grep alone misses
the early-return case, which is the most common one.

---

## C2 · History mutation

**All languages**: assignment into an element of the message collection —
`messages[i].x =`, `msg.content =`, `.update(`, `.pop()`/`.splice()` outside
a declared compaction path.

**Python** additionally: in-place list operations, mutation of a dict already
appended to the history list.

---

## C3 · Crash and checkpoint

Look for the persistence layer, then: writes not routed through a
write-temp-then-rename, absent `fsync`, multi-record brackets (a start record
and an end record) with no reader-side detection of a missing end, and resume
paths that don't check whether an operation already ran.

---

## C4 · Model output parsing

**TS/JS**: `JSON.parse(` applied to anything derived from the response ·
stream reader loops · `delta.index` · accumulation keyed by index
**Python**: `json.loads(` on response content · `async for` over the stream ·
`choices[0]` without bounds checking
**Go**: `json.Unmarshal` into a struct with no error branch · `bufio.Scanner`
over the SSE body

Also search for handling of a repeated tool-call id — usually its *absence*
is the finding, so check the accumulation structure: a map keyed by id
silently overwrites on duplicate.

---

## C5 · Paths

**TS/JS**: `path.join(` without a following `path.resolve` + `startsWith`
check · `fs.realpath` absent · `lstat` vs `stat`
**Python**: `os.path.join(` · `pathlib` `/` operator · `os.path.realpath`
absent · `open(` on a path that wasn't the validated variable
**Go**: `filepath.Join` · `filepath.EvalSymlinks` absent

The high-yield pattern: a validation function that returns a boolean, with
the caller then opening the *original* string rather than a normalized one.

---

## C6 · Environment and secrets

**TS/JS**: `spawn(`/`exec(` with no `env` option (inherits) or `env:
process.env` · `...process.env`
**Python**: `subprocess.run(` with no `env=` · `env=os.environ`
**Go**: `exec.Command` without setting `cmd.Env`

Also: logging of full request bodies, and tool output entering history with
no secret scan.

---

## C7 · Error taxonomy

Search for the error type definitions. Signals of trouble: `throw new
Error(` / `raise Exception(` with a string message in the tool or provider
layer; `catch (e) { }`; catching a base exception class; error text matched
with string comparison to decide retryability.

---

## C8 · Partial success

Same combinators as C1, plus any function returning a single status for a
batch. Look at the return type: `Result<T>` over a batch of independent
operations is the shape to question.

---

## C9 · Idempotency

Find the retry loop first, then read outward to see what it encloses. Search:
`retry` · `backoff` · `for attempt in` · `tenacity` · `p-retry`.

Then search inside that region for writes, `spawn`/`exec`, and outbound
posts. Also search for `idempotency` / `idempotencyKey` — its absence around
a side-effecting call is the finding.

Timeout-after-commit specifically: look at how a timeout on a side-effecting
call is classified. If it maps to the same branch as a connection refusal,
that is the defect.

---

## C10 · Cancellation

**TS/JS**: `new AbortController` · every `fetch(` — check for `signal:` ·
`spawn(` — check for a kill on abort · `setInterval`/`setTimeout` without a
matching clear on the error path · `process.kill(pid` vs `process.kill(-pid)`
(negative pid = process group)
**Python**: `asyncio.CancelledError` swallowed · `task.cancel()` without
awaiting · `subprocess` `terminate` vs `killpg` · `signal=` parameters
**Go**: `context.Context` accepted but not passed down · `cmd.SysProcAttr`
`Setpgid` absent · goroutines started without a done channel

The single highest-yield grep across all languages: every process spawn, then
check whether a kill exists anywhere in the same scope.

---

## C11 · Timeouts

Search all timeout constants and their units, then map which wraps which. The
finding is a *relationship*, not a single value, so you must list them
together. Watch for units — a value in seconds compared against one in
milliseconds is its own bug.

---

## C12 · Loop limits

`maxTurns` · `max_iterations` · `while True` / `for {}` in the loop file ·
depth or recursion parameters on delegation. Absence is the finding, so check
the loop's exit conditions explicitly rather than searching for a constant
that may not exist.

---

## C13 · Truncation

`compact` · `truncate` · `summarize` · `slice(` / `[-n:]` on the message
collection · token counting functions.

Then read the cut selection: if the index comes from a token budget with no
subsequent pairing check, that is the finding.

---

## C14 · Prefix determinism

Search the system-prompt build and tool-serialization paths for:

**TS/JS**: `Date.now` · `new Date` · `toISOString` · `Math.random` ·
`randomUUID` · `crypto.randomUUID` · `process.pid` · `os.hostname` ·
`Object.keys(` over a runtime map · `Set`/`Map` iteration without sort
**Python**: `datetime.now` · `time.time` · `uuid4` · `random` ·
`os.getpid` · `socket.gethostname` · dict iteration in older-style code
**Go**: `time.Now` · `rand.` · `uuid.New` · `os.Getpid` · map range
(unordered by specification — a map range in prefix construction is a finding
by itself)

Go's unordered map iteration makes C14 violations especially likely there;
check every map range on the serialization path.

The empirical test beats all of this: build the request twice from identical
state and diff the bytes. Recommend it regardless of what the search finds.

---

## C15 · Trace and replay

Search for the event or span emission points and check coverage against:
turn boundaries, tool call, tool result, request composition, retry,
truncation, approval. Then check whether usage figures — including cached
input tokens — are recorded anywhere. Providers report cache reads and writes
separately; if only a single total token count is stored, cache hit rate
cannot be computed and C14 has no regression protection.
