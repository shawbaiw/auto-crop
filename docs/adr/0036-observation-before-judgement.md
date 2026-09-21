# Observation Before Judgement

Status: accepted. Delivers P1 of [the execution health plan](../execution-health-and-recovery-plan.md); the judgement it withholds is P4.

## Context

The runtime could not see a run. An Agent Run recorded when it started, its budget, and eventually how it ended — nothing in between. Every question worth asking about a long task ("is it working or wedged?", "which part is slow?", "did it go quiet, or did we just stop looking?") had one available answer: the wall clock. So a fixed timer decided, and a task that was working fine past its budget died the same death as one that had hung.

The tempting fix is to make the timer smarter. That is the thing to avoid: a smarter verdict built on the same absence of data is a fixed timer with a new name. There was no measurement of what a healthy run actually looks like, and no way to get one without first being able to watch a run without killing it.

Three facts shaped what "watching" had to mean.

**A run is not one process.** Its brief, its substantive work and its Artifact Syntax Repair (ADR 0028) are separate launches sharing one `agent_runs` row. Attributing a silence or a budget to "the run" cannot say which of them was slow, and a brief that timed out was already being reported against the task's budget rather than its own (ADR 0032).

**Output is not progress, and silence is not death.** An agent printing into a retry loop is busy and getting nowhere. An agent thinking for four minutes is working. Whatever records these has to keep them as separate facts rather than collapsing them into one liveness signal.

**Raw output cannot be the record.** A streaming agent produces tens of thousands of chunks; a row per chunk makes the observation cost more than the work, and copying the text drags prompts and credentials into a second place. But aggregating has its own trap, found while testing this: a summary written when its window closes carries a flush time, and measuring "how long before the agent said anything" from a flush time charges the whole window to silence. The throttle distorts the statistic it exists to make affordable.

## Decision

**Record what a run does. Decide nothing.**

- Phases (`preparing_brief`, `executing`, `repairing_artifact`, `finalizing`) are recorded one invocation each in `run_invocations`, with what ended them. The run row carries the current phase; the table keeps the sequence.
- **A heartbeat is the owner runner answering, on a clock the runtime owns — never the agent's output arriving.** `lastHeartbeatAt` and `lastActivityAt` are independent columns, written by independent paths. A fresh heartbeat beside a long silence is a state the model must be able to express: the runner is fine, the agent has said nothing, and that is not yet a verdict about either.
- Output becomes bounded **activity summaries**: bytes per channel, never the text. Each summary spans real arrival times at **both** ends — when its first byte came and when its last one did — so no statistic derived from it depends on when the flush happened to land. Each also carries the longest gap observed *inside* its own window, so aggregation cannot make a silence shorter than it was.
- **Missing data means unknown, never silent.** A run predating observation, one whose adapter reports nothing, and one whose observation writes failed all report null. Reading null as "produced nothing" is precisely how a healthy long task gets declared dead.
- Observation writes are best-effort and bounded: a database that will not take a log line says the run is unobserved, not that the work failed. Failures are counted, surfaced as a task warning, and after a few the observer stops trying rather than hammering a broken database for the rest of the run.
- The adapter's `observe` sink is optional and outbound only. An adapter that reports nothing still runs; nothing an adapter reports can end its own run.

**Nothing here judges.** A test scans this module's source and fails the build if it so much as mentions a run-status write, a task transition, or a lock. The temptation is local and real — the observer already knows the run is silent, and ending it from there is two lines.

## Considered options

- **Go straight to health-based stopping.** What the problem asks for, and it would have shipped thresholds nobody had measured. Watching first is what makes the eventual policy answerable to evidence.
- **Derive liveness from stdout.** One signal instead of two, and free. It gets both interesting cases backwards: the loop looks healthy, the thinker looks dead.
- **Store raw output as the activity record.** Simplest to write and a duplicate of the log, with prompts and credentials copied into a table that exists to be queried.
- **Write one row per chunk and aggregate on read.** Keeps exact timings, and makes a chatty run's observation cost more than the run. Aggregating on write, with both window ends and the in-window gap kept, preserves what the statistics need.
- **One timestamp per summary.** What this first had. The flush time overstated first-output delay by a whole window, which a test caught before it shipped.

## Consequences

- A run's phases, silences and byte volumes are answerable from stored rows, by a pure function, long after the run is over — so the health policy that eventually reads them is testable without a database or an agent.
- Behaviour is unchanged. The whole existing regression suite passes untouched, which is the claim this phase is making: the runtime can now see a run and still cannot judge one.
- Only stdout and stderr are observed. There is no structured model or tool event stream, so this deliberately does **not** claim support for a reliable model-idle timeout; `lastProgressAt` is likewise absent, because a checkpoint needs a trustworthy source and there is none yet.
- The cadences (10s aggregation window, 20s heartbeat) are starting values chosen to be cheap, not thresholds justified by measurement. Recording them under a stored `policyVersion` is what lets them change without silently rewriting what old runs meant.
- `run_activity` has no retention bound yet. The plan requires one, and a long-lived local database will grow until it gets one.
