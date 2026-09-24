# A Run Spends A Pinned Task Authorization

Status: accepted for internal P4.1–P4.2 validation; not enabled by the CLI.

A soft checkpoint buys another observation window within an existing authorization, not another run or more time. The `budget-v1` run pins its resolved policy when it claims execution, reserves from a durable Task authorization, and meters the whole claim-to-settlement lifetime with its owner's monotonic clock. Changing configuration, changing run ID, resetting failure counters or restarting a Worker cannot replenish that Task authorization. Environment timeout overrides map to the soft checkpoint; they cannot lift the run or Task hard cap.

Reservation, ownership epoch, workspace claim and the running transition commit together. The already-established Task lock protects preparation and is bound to the run in that transaction. Periodic accounting renews ownership, records cumulative consumption and emits any checkpoint event in one short transaction. Settlement's conditional claim also commits its ledger entry and refund; failed settlement rolls these back together. Sequence-numbered ledger rows preserve earlier measurements, and a settled reservation cannot be charged or refunded again.

Only the owning monotonic meter can prove a refund. An external settlement, a lost Worker, missing termination evidence or an untrustworthy clock consumes the full reserved amount with an explicit estimate. This deliberately overestimates rather than allowing a crash to create spendable time. A missing reservation or unknown policy fails closed. Existing authorizations cannot silently fall back to the legacy policy.

## Time and scope

Monotonic readings never cross a process boundary. UTC is audit time and a discontinuity signal, not an independent lease on extra runtime. A significant wall/monotonic divergence, reversal or delayed sample beyond the configured tolerance withdraws continuation permission and records a persistent owner dispatch gate; the reservation remains conservative. This treats suspend/resume as uncertain timing, not a diagnosed deadlock. There is no automatic resume after such uncertainty in P4.1: stop/confirm or isolate, then restart through supervised reconciliation with a fresh owner. More permissive wake probing and a recovery grace window remain part of the P4.3 health policy.

A live budget run is not reaped by the legacy wall-clock deadline, even if a dashboard read supplies a distant UTC time. The owner checks phase/run remaining time before each adapter invocation and before committing success; the adapter's timer is the minimum remaining allowance. Brief, work, repair and finalization all spend the same reservation, without an extra 150 seconds. Output cannot renew that allowance. Termination grace is containment overhead, not permission to accept an over-budget success.

P4.1–P4.2 expose only an internal scheduler option for isolated tests. The production CLI stays on observe. Dedicated budget Holds, explicit additional authorization and atomic stopping are implemented in P4.2; dashboard controls and user-facing enablement remain P4.3. A live wedged owner still needs P4.3 independent health enforcement; owner exit uses the K3 reconciliation path today. Never enable new-mode production scheduling merely because these foundations pass their tests.

## Stop and renewed authorization

A durable stop request and its outbox event commit before the owner signals cancellation. Every conditional success claim rejects a run with a stop request. A stop that wins between the owner's precheck and success claim is settled as a stop, never left as an apparent success. The run stays running while containment finishes, preserving ownership until the normal settlement transaction records the outcome, budget charge and budget event. Termination wait is separate telemetry; it cannot buy more execution. Unconfirmed termination retains workspace isolation and conservatively consumes the reservation.

Stage/run/Task exhaustion opens an Execution Budget Hold. It does not spend the task's failure-attempt allowance, but its actual runtime remains charged, as does a quota stop. Ordinary recovery keeps a budgeted Task's identity even with Partial Output; creating a recovery Task would accidentally mint a fresh authorization. An exhausted queued Task is parked again without spawning after a reset or restart.

The founder can resume the same Task with remaining allowance or explicitly add time. The authorization audit, increased Task balance, cleared budget Hold and queued transition share one transaction. A request ID makes repeats idempotent; an expected prior authorization rejects stale grants. Cancellation, active claims and other unresolved Holds reject new grants. Confirming termination releases isolation but still requires budget authorization when exhausted or stopped by a budget limit. Old run snapshots remain unchanged; future runs pin the new total. This intentionally preserves an audit boundary between permission to continue and ordinary retry counters.

## Migration and rollback

Migration adds nullable run snapshots and separate authorization/reservation/ledger tables; historical runs get no invented consumption. Migrate an isolated copy first and do not mix old writers with budget runs. To revert the internal option, drain or reconcile all new-mode runs first. Tasks with an existing authorization remain gated in observe mode; toggling the option is not a budget reset. Keep ledger and authorization data through any later retention work.
