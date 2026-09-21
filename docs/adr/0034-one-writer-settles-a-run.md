# One Writer Settles A Run, And A Delivery Gets Time To Land

Status: accepted

## Context

Two writers reach every Agent Run, and nothing ordered them.

The dispatch settles the delivery: capture proof, capture the Business Artifact, repair its syntax if it does not parse (ADR 0028), record the run's outcome, finalize. Meanwhile `reconcileStaleRunningTasks` declares runs past their budget timed out — and it is reachable from any read of company state (`buildCompanyState`), which shares a process and an event loop with the scheduler. So a client polling the dashboard could land in the middle of a settlement.

Neither write was conditional. `updateAgentRunStatus` was `WHERE id = ?`, and the failure columns use `COALESCE`, so whoever wrote second kept the other's failure reason. A controlled reproduction (scheduler tests) left this behind:

```
run  : status = complete,  failure_reason = "timeout"
task : status = complete,  latestFailureReason = "timeout"
```

A run both finished and timed out; a task carried a failure it had not suffered. The lock was released by one writer while the other was still writing. Nothing said which record was true, so nothing downstream — recovery, key results, diagnosis — could be read with confidence.

Two more facts shaped the fix. The window is not a bug in one function: the database's deadline runs from `startedAt` (when the run row is created) while the child process's timer starts at spawn, and ADR 0028's repair holds the run `running` for up to two more minutes after the agent returns. And the obvious guard — write `complete` early to claim the run — is worse than the problem: `complete` is an outcome, not a phase, and once written the conditional update would block correcting it to `failed` if capture then fails.

## Decision

**A settlement claims its run, and the claim is the conditional write of the run's own outcome.**

- `updateAgentRunStatus` takes an optional `expectedStatus` and returns whether it wrote. With it, the update lands only while the run is still `running`.
- Every branch that settles a dispatch claims first and writes nothing if it lost: no artifact, no task transition, no events, no key result, no downstream wake. The loser is silent.
- The Business Artifact is persisted by the branch that settles, after the claim — not before the branches, where it used to be written by a settlement that might lose.
- **The rule is reciprocal.** `reconcileStaleRunningTasks` claims the same way; losing means the scheduler settled this run while it was deciding the run was dead, and then it touches nothing — not the task, not the lock, not the failure event.

**A run keeps a finalization grace past its budget.** The stale-run deadline is `startedAt + effectiveTimeoutMs + FINALIZATION_GRACE_MS`, where the grace is derived from `ARTIFACT_SYNTAX_REPAIR_TIMEOUT_MS` plus a margin for capture — so it moves when the repair's own cap moves, rather than being a number someone picked. A run still finishing is not declared dead; a run that stops inside the grace is still reaped once the grace expires, so nothing is parked forever.

## Considered options

- **Write `complete` early as a claim token.** Uses an outcome to mean "in progress": a capture failure afterwards leaves a run marked complete with no delivery, and the new condition blocks correcting it.
- **A `finalizing` phase with its own deadline.** Expresses the state honestly and is where this goes if settlement grows more steps. Today it buys a distinction the grace already covers, at the cost of a new state every reader must learn.
- **Keep the deadline and let the settlement lose.** Simpler, and it throws away work that succeeded — the repair runs precisely when a delivery is nearly done, so the loss would be common.
- **Stop the read path from reconciling.** Removes one trigger, not the class: the same race exists between the scheduler and any second worker.

## Consequences

- Whoever wins writes a coherent record; the loser leaves nothing. Both directions are tested, and each asserts the loser's silence rather than only the winner's result.
- A genuinely stuck run is declared dead about two and a half minutes later than before. Acceptable: `reconcileStaleRunningTasks` is a post-crash reconciler, not a live watchdog — dispatch is blocked while a task runs, so it never fires mid-run except from a read path.
- A task's effective wall-clock ceiling is now its budget plus the grace. This is a real change to what "budget" means, and it is deliberate: the budget covers the agent's work, the grace covers the runtime's own bounded finishing steps.
- Known limitation: the claim decides who may write; it does not make the writes atomic. A crash mid-settlement can still leave part of one. Grouping those writes in `repositories.transaction()` is a separate change.
- Known limitation: a crash between acquiring the task lock and creating the run row leaves a lock and a task no reconciler can see, because reconciliation is indexed by running runs. Unchanged here.
- Known limitation: the grace applies to every run, including those that never reach a settlement. Making it conditional needs the phase this ADR declined.
