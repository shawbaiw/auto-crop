# A Settlement Is One Transaction, And A Lock Names The Run It Guards

Status: accepted. Extends [ADR 0034](0034-one-writer-settles-a-run.md), which left both of these as known limitations.

## Context

ADR 0034 made the run claim conditional, so only one writer settles a run. It said plainly what it had not done: "the claim decides who may write; it does not make the writes atomic," and a lock left behind by a dead dispatch is invisible to a reconciler indexed by running runs.

Controlled reproductions of both gaps are recorded in [the P0 baseline](../execution-health-p0-baseline.md). They are worse than "not atomic yet":

**The claim guarded the wrong subset.** Proof rows, the handoff package and the Artifact Workspace pointer were written on the way to the claim, so a dispatch that lost still left the winner's task carrying a proof row, still published a directory the next task reads as this task's output, and still repointed that task's output at a workspace belonging to a run that had been declared dead. One settlement path — the Bounded Recovery ceiling — never claimed at all, so a loser could overwrite the winner's outcome and add a second Hold on top of the winner's, leaving a task parked for two contradictory reasons (ADR 0020).

**An interruption between the claim and the commit was unrecoverable.** Claiming settled the run row; the delivery, the Task transition and the completion events came after. A failure in between left a run recorded as finished beside a task recorded as running — and nothing would ever look at that task again, because reconciliation reads `running` runs and this one was settled. Not a lost update: a task stuck in `running` with no Hold, no delivery and no way out.

**A dispatch released whichever lock the task had.** Locks are keyed by task and owner, and one process dispatches under one `workerId`, so the two are not enough to tell two dispatches of the same task apart. An unwinding dispatch deleted the lock its own successor had just taken, and the successor ran on unlocked — a second writer in the same workspace, which is the thing the lock exists to prevent.

One more fact shaped the fix. Under a second connection — which the planned out-of-process Supervisor will open — a transaction that reads before it writes holds only a read snapshot, and the upgrade to a write fails outright once anyone else has committed. `busy_timeout` does not help, because the snapshot is stale rather than the lock busy. `multiConnection.test.ts` pins this against a real file.

## Decision

**A settlement is one transaction, and the claim is its first statement.**

- `settleRun` opens a transaction, claims the run conditionally, and runs the caller's commit only if the claim landed. Proof rows, the delivery, the Artifact Workspace pointer, the Task transition, the Hold, the dependency impact and the completion events are all inside it. They land together or not at all, so an interruption leaves the run `running` — still reachable, still governed by its deadline.
- The claim goes first because that takes the write lock up front, leaving no read snapshot to invalidate. This is the same order ADR 0034 already required for a different reason; the two agree, and the ordering is now load-bearing rather than stylistic.
- Nothing inside the transaction may await a model, a process or the filesystem: it holds SQLite's write lock for its whole duration. A test scans the settlement call sites and fails the build on `await` or filesystem calls, because the cost of getting this wrong is a database that stops accepting writes for minutes with nothing in the logs to say why.
- The Bounded Recovery ceiling became an *outcome a settlement carries* rather than its own writer. Reaching the ceiling changes the run's recorded reason; it no longer settles anything on its own.
- The handoff package is published **after** the transaction commits, and only by the winner. Files do not roll back, so publishing inside would leave the next task reading output from a settlement that unwound.

**A task lock records which run it is held for.** `task_locks.run_id` is bound when the run is created; a release must name the same run. A dispatch can therefore only ever release its own lock. Whoever settles a run they did not dispatch releases by run id instead, which also refuses to unlock a *different* run that is still live.

## Considered options

- **Keep the claim-only guard and accept partial settlements.** What ADR 0034 did, deliberately and temporarily. The stranded-`running` task is not a rare interleaving; it follows from any throw in a multi-statement sequence, and it has no exit at all.
- **Add `ownerEpoch` now instead of `run_id`.** The eventual model, and more than this needs. An epoch earns its keep when ownership can move between workers; today one process dispatches, and the run id already separates two dispatches of the same task. Deferred rather than rejected.
- **Wrap the settlement in a transaction but read first.** Reads well, and fails under a second connection exactly when contention is real. Rejected on the evidence above.
- **Put the handoff package inside the transaction.** Would make the whole settlement look uniform and would be a lie: a rollback cannot delete the files.
- **Set `busy_timeout` so a second connection waits.** Worth doing when a second connection exists; it does not address the stale-snapshot failure, which is the one that matters here.

## Consequences

- The loser of a claim now writes nothing anywhere: no proof, no published handoff, no pointer move, no second Hold. The P0 baseline assertions that recorded the old behaviour were rewritten to assert this, which is how the fix proves itself.
- An interrupted settlement rolls back to `running` and is reaped by its deadline like any other unfinished run. The failure is visible instead of silent.
- `runtime/locks.ts` is gone. It was a second implementation of the same lock semantics, exported from the package and used only by a test, and it had already diverged from the guarded one — two implementations of "who holds this task" is how the release bug survived.
- A settlement holds the write lock for its duration. That is short and bounded today; it is also why the no-await rule is enforced mechanically rather than by review.
- Still open, and not addressed here: the lock and the run are created in two steps, so a crash between them leaves a lock bound to no run. `releaseTaskLockForRun` deliberately releases an unbound lock so this does not strand a task, which is narrower than the old behaviour but not yet correct. Closing it needs the lock, the run and the `running` transition created together.
