# Dependency Cascade After CEO Approval

Auto-Crop will propagate dependency readiness after CEO Office approves a task with Consumable Proof. The first implementation will re-evaluate direct downstream consumers and move dependency-blocked tasks back to `queued` when all of their dependencies are ready.

## Context

Auto-Crop already gates downstream work on Proof. A task may not start just because an upstream agent reported useful output; the upstream deliverable must be recorded as Proof and accepted through CEO Office.

This creates a visible continuity gap. When an upstream task first reports without Proof, downstream tasks can become blocked because the dependency has no Consumable Proof. If the upstream department later supplies valid Proof and CEO Office approves it, the upstream task becomes complete, but the downstream task can remain blocked until a user manually refreshes it.

That manual refresh makes the project feel less like an operating company and more like a set of disconnected task rows. The runtime should maintain dependency-derived state after the accepting event occurs.

## Considered Options

- **Keep manual refresh as the only dependency repair path:** simplest implementation, but it leaves users responsible for re-checking facts the runtime already knows.
- **Let Proof capture trigger downstream work:** faster, but it bypasses CEO Office as the owner of completion review.
- **Let CEO approval directly start downstream tasks:** continuous, but it mixes dependency state propagation with scheduling and execution.
- **Run Dependency Cascade after CEO approval:** keeps CEO Office as the acceptance gate, keeps the scheduler as the execution mechanism, and removes the manual refresh gap.
- **Implement full recursive cascade immediately:** more complete, but it introduces cycle protection, event de-duplication, parent aggregation questions, and larger blast radius before the direct handoff problem is solved.

## Decision

Auto-Crop will add **Dependency Cascade** as a runtime propagation step after CEO Office approves a task with Consumable Proof.

The first implementation will:

- trigger only from CEO approve decisions
- require the approved task to have Consumable Proof
- inspect only direct dependency consumers of the approved task
- re-evaluate each consumer against all of its Task Dependencies
- update only `blocked` and `waiting_dependency` consumers whose current blockage is dependency-related
- move ready consumers to `queued`
- avoid changing tasks in `queued`, `review`, `running`, `complete`, `failed`, `cancelled`, or `needs_replan`
- publish cascade events over SSE
- return cascade updates in the CEO review decision API response
- treat cascade failures as non-blocking warnings rather than rolling back the CEO approval

Dependency Cascade does not execute tasks. It only restores dependency-derived readiness. The scheduler remains responsible for starting queued work.

The first implementation will not recursively propagate through longer task chains, will not aggregate parent tasks from department subtasks, and will not trigger from recovery, refresh, replan confirmation, or follow-up task approval.

## Consequences

The common handoff path becomes continuous: once CEO Office accepts Engineering Proof, direct Growth consumers can unblock without the user clicking Refresh.

CEO Office remains the completion acceptance gate. Departments cannot unlock downstream work by merely producing Agent Output or unapproved Proof.

The scheduler boundary remains intact. Dependency Cascade makes downstream work eligible; it does not decide execution timing.

The first implementation intentionally leaves a narrower model than the eventual runtime needs. Future work should extend the same service to bounded recursive propagation, additional trigger points, parent task aggregation, and optional scheduler wakeup after cascade completion.
