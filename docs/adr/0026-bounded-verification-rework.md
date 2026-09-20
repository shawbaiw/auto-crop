# A Failed Verification Is Reworked Within A Round Budget

Status: accepted

## Context

After ADR 0023 a verdict that did not pass stopped its verifier on a `verification_failed` Hold. That was the right floor — a failed report could no longer pass as a delivery — but nothing then acted on it. A defect the producer could fix sat until someone noticed, recovered the verifier by hand, and hoped the producer's output had changed in between; nothing told the producer what had failed.

Bounded Recovery (ADR 0015) does not cover this. Its ceiling counts failed and abandoned Agent Runs; a producer that delivers, a verifier that runs and reports, and a producer that delivers again are all successful runs, so a loop of "delivered, verified, failed" is invisible to it and unbounded if automated naively.

## Decision

**A verdict that did not pass is decided, recorded, and — within a budget — acted on automatically.** `applyVerificationRework`, called from delivery finalization for both entry points, records one `verification_reworks` row per failed report with one of four decisions:

| Decision | When | Effect |
| --- | --- | --- |
| `rework_producers` | a check `failed` | The faulted producers' current artifacts are marked `returned` and the producers are requeued; the verifier waits on them under a named dependency Hold. |
| `reverify` | nothing failed but the verdict no longer covered current output, **or a faulted target has since delivered a new version** | The verifier is requeued against the current output. |
| `escalated` | a check was `not_run`, or a faulted producer is held by something a verdict does not answer (a Founder Decision, an approval) | The verifier parks on `verification_failed`. Re-producing the same work would not change the outcome. |
| `exhausted` | the round budget is spent | The verifier parks on `recovery_exhausted`, whose only way forward is a replan. |

**The budget is three verification rounds per verifying task**, the first included, so at most two automatic reworks (`MAX_VERIFICATION_ROUNDS`). A round is a failed report, recorded once however often that report is finalized; the record is in the database, so a restart, a refresh or a producer's new delivery does not reset it. A replan replaces the verifier with a new task, and only that starts a new budget.

**Rework is feedback, not a dependency.** The producer does not gain a dependency on its verifier, which would be a cycle. Its next dispatch reads the pending rework records and its prompt gains a `## Rework Requested` section listing each failed check with its requirement and evidence. Finalizing the producer's next delivery marks the rework redelivered; its new output satisfies its consumers again, the verifier's readiness resolves, and it verifies a fresh snapshot.

**A verdict is only evidence about the version it judged.** Before deciding, each faulted target is compared with its producer's current Business Artifact. A failure on a version that has since been superseded is not evidence against the new one, so it re-verifies instead of sending the new version back, and only the artifact a verdict actually judged is ever marked `returned`.

**A split producer is reworked through its own stages.** When a faulted target is a parent task with department subtasks, re-running the parent would rewrite the files inside its execute stage's workspace — output an internal verdict has already passed on, without that verdict being taken again. Instead the stages that produce the output are requeued with the feedback, their internal verifier is parked to verify the new output, and the parent waits to aggregate again. Every verdict keeps describing output it checked.

**Each rework is one unit of work.** `applyVerificationRework` runs inside a transaction, as does the delivery finalization that calls it, so a record can never exist without the returns, requeues and Holds it stands for. Without that, an interruption between writing the record and acting on it leaves a round spent, the producer untouched, and every later attempt reading the record as "already handled". `repositories.transaction` nests through SAVEPOINTs.

**Rework goes only where the checks point.** A check may name `target_task_id`; when every failed check does, only those targets are reworked. A failed check naming no target sends all targets back, because the runtime cannot tell which one was at fault.

## Considered options

- **Count verification loops with the Bounded Recovery attempt counter.** It counts failed runs, and every run in this loop succeeds.
- **Make the producer depend on its verifier for rework.** A cycle in the task graph, which readiness, aggregation and the cascade all assume cannot exist.
- **Retry the verifier alone on failure.** Re-checking unchanged output reproduces the same verdict; only `reverify` does that, and only when the verdict was about output that has since changed.

## Consequences

- A fixable defect closes on its own: fail, rework with the failed checks as feedback, re-verify, pass. Tested for a department's internal Validate stage and for verifiers the CEO planned — a website whose producer was split, a data-cleaning job and Chinese written content — from company creation.
- A defect that is not fixed stops after three rounds with a Hold that offers only replanning. No path approves a failed verdict.
- Known limitations:
  - A failed check that names no target reworks every target.
  - Consumers that already took a producer's output before it was returned are not rolled back, and consumers that are still queued or running are not yet re-parked or warned when an input is returned. Surfacing an invalidated input is part of the later UI slice.
  - Version correspondence is judged by artifact id. A producer whose files change without a new artifact is not detected, which is why a split producer is reworked through its stages rather than through the parent.
