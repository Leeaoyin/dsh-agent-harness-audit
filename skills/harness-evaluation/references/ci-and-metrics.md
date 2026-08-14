# CI integration, metrics, and thresholds

Every metric here has a default threshold. A metric without a threshold
cannot gate anything, and an ungated metric becomes a report nobody reads —
which is how most of these efforts actually die.

The defaults below are starting points, not universal truths. Set them from
your own first week of data, then only ever tighten them.

---

## 1. Three pipelines

### Pull request — deterministic, fast, free

Scripted model, fake tools, fault injection, oracles. No network, no real
model, no external services.

Target: under five minutes. **Gate: 100% pass.** This suite is deterministic;
a failure is a defect, not noise. If it becomes flaky, fix the flake as a P1
— a flaky blocking gate gets disabled within two weeks and then you have
nothing.

### Nightly — real model, repeated

Production-like scenarios against the real provider, each repeated. Measures
what determinism can't: whether the harness holds up against real model
variance.

**Not a blocking gate.** See flake policy below.

### Release — chaos and migration

Network partition, service restart, store unavailable, queue delay, worker
crash, corrupted checkpoint, schema migration, concurrent sessions.

**Gate: zero P0 violations.** P0 list at the end of this document.

---

## 2. Metrics and default thresholds

### Safety — these gate releases

| Metric | Definition | Threshold |
|---|---|---|
| Duplicate side effects | Effects executed more than intended, across all fault scenarios | **0. No tolerance.** |
| Unauthorized actions | Operations executed outside the granted permission scope | **0** |
| Cross-tenant access | Any read or write crossing a tenant boundary | **0** (multi-tenant only) |
| Approval replay | A single approval authorizing a second operation | **0** |
| Orphaned tool calls | Calls with no matching result in the transcript | **0** |
| State divergence after recovery | Recovered state differing from normal-execution state | **0** |

Zero means zero. These are correctness properties, not quality metrics. One
violation blocks release regardless of how good everything else looks.

### Reliability

| Metric | Definition | Threshold |
|---|---|---|
| Deterministic suite pass rate | PR pipeline | **100%** |
| Fault recovery rate | Fault scenarios ending in an allowed status | **≥ 95%** |
| Success rate | Nightly, single run per scenario | **≥ 90%** — set from your own baseline |
| pass^3 | Scenarios succeeding in 3 of 3 consecutive runs | **≥ 80%** |
| pass^5 | Scenarios succeeding in 5 of 5 | **≥ 70%** |

`pass^1` is just the success rate — don't report it twice.

The gap between success rate and pass^5 is the useful number: it measures
how much of your apparent reliability is luck. A harness at 95% success and
50% pass^5 is far less stable than the headline suggests.

### Cost

| Metric | Definition | Threshold |
|---|---|---|
| Tokens per scenario | Total input + output | Alert on **+20% week over week** |
| Cache hit rate | Cached input tokens ÷ total input tokens | **≥ 60%** on multi-turn scenarios |
| Retry amplification | Total attempts ÷ logical operations | **≤ 1.2** |
| Tool calls per task | Median | Alert on **+30%** |

Cache hit rate is the one people skip. A harness that regresses from 80% to
0% cache hits has roughly tripled its bill with no test failing and no error
logged. Track it or the C14 defect will come back.

### Latency

| Metric | Threshold |
|---|---|
| P95 wall clock per scenario | Set from baseline; alert on +30% |
| P99 | Alert on +50% |
| Time to cancel | **< 2s** from signal to full quiescence |

Time to cancel is a robustness metric, not a performance one. It directly
measures C10.

### Recovery

| Metric | Threshold |
|---|---|
| Crash recovery rate | **100%** — every kill point resumes to correct state |
| Checkpoint restore rate | **100%** |
| Replay success rate | **≥ 95%** — recorded runs replay to the same trace |

---

## 3. Flake policy

`pass^5` is noisy by construction. Without a stated policy, the first red
night gets the job marked allow-failure and it becomes decoration. Decide
this before turning nightly on:

**Nightly never blocks merges.** It reports trend.

**Classify each failure the next morning** into: harness defect (file it,
add a deterministic test — this is the goal), model variance (record and move
on), scenario defect (fix the scenario), infrastructure (fix or quarantine).

**Quarantine is time-boxed.** A quarantined scenario carries an owner and a
date. Expired quarantine is a build failure — otherwise quarantine becomes a
graveyard.

**Trigger for action: a scenario's pass^5 drops by more than 20 points
week over week, or safety metrics move off zero at all.** Safety metrics are
never quarantined.

---

## 4. Cost control

Nightly is real model × repetitions × scenarios. That number grows quickly,
and "it costs too much" is the most common reason these suites get switched
off.

**Budget the suite explicitly.** Pick a per-night ceiling first, then fit the
scenario count and repetition count to it. Not the other way around.

**Tier the scenarios.** A small core set every night at 5 repetitions; the
long tail weekly at 3. Reserve full repetition for scenarios that have caught
something before.

**Push everything that can be deterministic into the PR layer.** Every
scenario that runs against the real model should have a reason it can't be
scripted. Most can be.

**Report cost in the nightly output.** A suite whose cost is invisible gets
cut in the first budget review; one that reports "caught 3 defects, cost X"
survives.

---

## 5. Report format

```yaml
run:
  pipeline: pr | nightly | release
  commit:
  cost_tokens:
  duration_s:

safety:          # any non-zero blocks release
  duplicate_side_effects: 0
  unauthorized_actions: 0
  orphaned_tool_calls: 0
  state_divergence: 0

reliability:
  deterministic_pass_rate:
  fault_recovery_rate:
  success_rate:
  pass_3:
  pass_5:

cost:
  tokens_per_scenario:
  cache_hit_rate:
  retry_amplification:

recovery:
  crash_recovery_rate:
  replay_success_rate:

failures:
  - scenario:
    classification: harness | model-variance | scenario | infra
    replay:
```

The `classification` field is what makes the report actionable. An
unclassified failure list is a list nobody triages.

---

## 6. P0 — blocks release

Any of these, once, blocks deployment:

- a side effect executed more than intended;
- an operation outside the granted permission scope;
- state corruption, or recovery to a state normal execution would not reach;
- a run that cannot be terminated;
- data crossing a tenant boundary;
- an approval bypassed or replayed.

These are not scored. They are binary.
