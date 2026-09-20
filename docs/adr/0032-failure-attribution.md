# A Failure Names What Actually Stopped, And Whose Budget It Spent

Status: accepted

## Context

Two failures from the real smokes were recorded against the wrong cause, and in both cases the record then drove the wrong recovery.

**A brief that timed out was reported as the task timing out.** `prepareExecutionBrief` runs under its own cap — `min(task budget, 60s)` — and the scheduler passed its result through as the run's result. A brief that took 60 seconds was written down as `timeout after 5m`, which sends the next reader to a substantive run that never happened. Worse, `timeout` is the one reason that earns an escalation, so the scheduler "retried with the long budget": a second brief against the same 60-second cap. A third path was waiting behind it — a timeout on the long profile routes a task to `needs_replan`, so a slow brief could have asked a founder to replan work whose budget was never tested.

**An exhausted account was recorded as the agent failing.** Both CLIs report it by printing a line and exiting non-zero: `You've hit your session limit · resets 7:10pm`. That became `agent_failed` and a `runtime_interrupted` Hold — "nobody modelled this" — for something entirely modellable. It also counted as an attempt: three quota-blocked dispatches would spend the Bounded Recovery ceiling (ADR 0015) and park the task on `retry_exhausted`, whose only exit is a founder replan, for a condition that resolves by waiting.

Both are the same defect in different places: a record that names a cause the facts do not support, which then selects a remedy for a problem nobody has.

## Decision

**A preparation failure is reported and retried as what it is.** It carries the preparation budget in its message, says substantive work was not dispatched, does not escalate the task's execution profile, and is not evidence for a replan.

**An exhausted account gets its own failure reason and its own Hold.** `agent_quota_exhausted` joins `AgentFailureReason`, with a Hold of the same name whose exits are running again once the quota resets or replanning if waiting is not acceptable. `runtime_interrupted` keeps meaning "nobody modelled this" (ADR 0020).

**A quota-blocked run does not count as an attempt.** The Bounded Recovery ceiling exists to stop blind re-runs of work that keeps failing; an outage the task had no part in is not one of those.

The signal is read in the adapter, from the CLI's own operational message, because neither CLI offers an exit code or a structured field for it. This is the one place the runtime reads text to decide something — it is the CLI's output about itself, not the agent's reply about its work, and it lives with the adapter that launched it.

## Considered options

- **Let the brief share the task's budget.** Removes the mismatch by removing the cap, and hands a slow planning reply the whole execution budget before any work starts.
- **Keep quota inside `agent_failed` and fix only the message.** The message would be right and the behaviour still wrong: the attempt still counts, and the Hold still says nobody modelled it.
- **Detect quota by watching for repeated instant failures.** Infers from timing what the CLI states outright, and cannot tell an outage from a crash loop.

## Consequences

- A stopped task names the step that stopped and the budget it actually spent, so recovery acts on what happened.
- A company that runs out of agent quota parks with a Hold that says so and keeps its recovery budget for real failures.
- Known limitation: the quota matcher is a set of phrases (`session limit`, `usage limit`, `quota exceeded`, `rate limit reached`) against the CLI's combined output. A CLI that rewords its message stops being recognised and falls back to `agent_failed`; a run whose own output quotes one of those phrases while failing for another reason is misread as a quota stop. The test pins both directions, including the false positive, so the trade is visible rather than assumed away.
- Known limitation: nothing schedules the retry after a quota resets. The task waits on its Hold until someone recovers it.
