# Retention Thins History, It Never Decides

Status: accepted; on by default (`AUTO_CROP_RETENTION=retention-v1`), `off` keeps history indefinitely.

Observation windows, delivered outbox events, invocation rows and intermediate budget metering grow with every run. P1 and P3 deliberately kept all of them and recorded the resulting unbounded growth as the gate before sustained operation. Retention closes that gate. Unlike the budget and recovery policies, the default is the bounded behaviour: the unbounded one is the defect, and nothing retention removes is an input to a decision.

## What may go, and what it leaves behind

- **Activity windows** (`run_activity`) of a finished run are compacted after 14 days: the statistics `summarizeRunActivity` derives from them — first-activity latency, longest gap, trailing silence, bytes per channel, window count — are written onto the invocation row in the same transaction that deletes the windows. Threshold calibration reads statistics, not windows, so it survives compaction.
- **Intermediate metering** (`budget_ledger` rows of kind `consumed`) of a settled run goes after 14 days. Reservation, budget review and settlement rows remain, as do all authorization records. Cumulative Task budget is computed from `run_budgets`, never from the ledger, so no balance changes. This refines ADR 0038's "keep ledger data": the audit boundary it protects — what was reserved, reviewed, settled and authorized — is kept; the five-second meter readings between them are not.
- **Delivered events** go 30 days after delivery, and only once their consumption is on record (a recovery decision exists).
- **Invocation rows**, with their compacted statistics, go after 180 days, and only once their activity is gone.

Row ceilings (1,000,000 activity windows, 200,000 invocations, 100,000 outbox events) remove the oldest eligible history early, but never anything finished within the last hour and never anything protected. A table that stays above its ceiling is reported as over capacity rather than forced under it.

## Protection outranks age and capacity

A run's history is eligible only when the run is terminal with a known finish time, holds no task lock or workspace claim (an isolated claim is the evidence a person needs before confirming termination), has a settled budget, is not the source of a pending or queued automatic recovery (which re-reads its source event and invocations when it fires), and is not the latest run of a Task with an open Hold. An event is eligible only when delivered, not claimed, not dead-lettered, decided, not the source of a pending or queued recovery, and not about a run that is still going — the only runs that can still emit an event under a deterministic id.

Recovery decisions and the once-per-Task recovery records are never deleted. They, not the outbox rows, are what keep an at-least-once redelivery from acting twice, so removing an old event cannot make it trigger recovery again.

## Mechanism

The Supervisor runs a sweep at most once an hour, after the work of its scan, and records the outcome in `runtime_state`; `GET /api/execution-retention` reads it with current row counts and never sweeps. Each batch is one short transaction that takes the SQLite writer lock before reading eligibility, so what it read cannot change before it deletes, and a busy Worker waits for at most one batch. A sweep stops after a fixed number of productive batches and reports itself truncated; the next continues. A failed sweep is recorded and logged, never thrown: housekeeping must not keep a Worker from starting.

Deleted rows free pages SQLite reuses; the file is not shrunk. Retention never runs `VACUUM`, which would hold the database exclusively. All periods, ceilings and batch sizes are overridable through `AUTO_CROP_RETENTION_JSON`; invalid configuration refuses to start.
