# A Subtask Delivery Is Internal, And Readiness Has One Rule

Status: accepted

## Context

ADR 0007 already said department subtasks may reach `review` with Proof as internal inputs to their parent and must not appear in CEO Pending; CEO Office reviews the parent's summarized result. The code had drifted from that in two places, and a live company stalled on both.

**Subtasks were put through acceptance.** The scheduler's completion path did not distinguish a subtask from any other task. Every subtask delivery ran the automatic-acceptance risk scan; an SEO company's slices all mention "Search Console", so all three subtasks of one parent landed in CEO review. Those that passed the scan were accepted — which also marked the parent's key result met, from a slice of the work.

**Two readiness rules disagreed.** Parent aggregation counted a subtask in `review` with Proof as ready and queued the parent. Four seconds later the scheduler's `resolveDependencyReadiness`, which requires an ordinary upstream to be `complete` with an accepted artifact, found the same subtask unaccepted and parked the parent again. The dependency cascade and Hold reconciliation used the scheduler's rule; aggregation used its own. ADR 0023's sibling edges (Execute consumes Define) put the stricter rule between subtasks too, so a Define left in CEO review would stop the chain at its first step.

## Decision

**One resolver answers "is it ready?" for every caller.** `resolveDependencyReadiness` classifies each dependency (`classifyDependency`):

- **Internal** — the upstream is a department subtask, and the consumer is its parent or a sibling under the same parent.
- **Ordinary** — anything else, including a task outside the parent consuming a subtask.
- **Cross-company** — refused.

Ordinary consumption keeps its rule: `complete` with an accepted, current, valid artifact. Internal consumption is ready when the subtask is `review` or `complete`, has Proof and a current valid deliverable, any verification verdict passed against still-current targets (ADR 0023), no Founder Decision is pending, and no Hold other than its own aggregation Hold is open. `review` plus Proof alone is not enough. Parent aggregation now calls this resolver instead of its own, so dispatch, aggregation, the cascade and reconciliation cannot answer differently for the same facts.

**A delivered subtask is held for its parent, not for a reviewer.** It goes to `review` under a new `awaiting_parent_aggregation` Hold (resolver `runtime`, subject the parent, bound to `review`), and its artifact stays `unreviewed`. It skips the risk scan, CEO review, the Task Completion Event, and the key-result update. A genuine Founder Decision it declares still parks it under `awaiting_founder_decision`, and its siblings wait on that decision. Its sibling consumers are re-evaluated straight away; the parent is left to its aggregation, which owns the parent's events.

**The derived Hold follows the task kind.** `deriveTaskHold` maps a subtask in `review` to `awaiting_parent_aggregation`, so Hold reconciliation — which repairs on every read — can never rebuild a CEO review for one.

**Every delivery is finalized by one policy.** `finalizeDelivery` decides what a valid delivered artifact means for its task, and both entry points call it: an Agent Run finishing, and proof recovered through refresh. In order:

1. A delivery that is already accepted on a complete task is settled — nothing is written again.
2. The Holds a delivery answers (`invalid_business_artifact`, `runtime_interrupted`) are cleared. Any other open Hold — a Founder Approval, a Human Action, an upstream wait — keeps the task where it is (`held`).
3. A verification verdict that did not pass parks the task on `verification_failed` (ADR 0023).
4. For an ordinary task, a risk-pattern hit routes it to CEO review, ahead of any declared decision.
5. A declared Founder Decision records its Task Completion Event once and parks the task on `awaiting_founder_decision` — for a subtask too.
6. A subtask is an internal delivery.
7. Otherwise Automatic Acceptance accepts it.

An earlier version of this change had two copies. Recovery parked a subtask as an internal delivery without reading its `open_decisions`, recorded no Task Completion Event, and so its siblings — whose readiness finds pending decisions through those events — consumed a choice the founder had not made. Recovery for ordinary tasks used to send every recovered deliverable to CEO review; it now gets Automatic Acceptance when eligible, like a finished run.

**Acceptance is idempotent.** `acceptTaskBusinessArtifact` asked to accept an artifact already accepted on a complete task records nothing again — no event, Task Completion Event, key-result update or cascade.

**A return releases the Hold its actor answered.** CEO Office returning a review and the founder returning a Founder Decision share `returnDeliveryForRework`. The founder's path used to call the CEO review route, whose guard requires the `ceo_review_decision` affordance; a task really parked on `awaiting_founder_decision` offers no such affordance, so every founder return on one was refused as stale. The existing test passed only because its seed left the task in plain `review` with no Hold.

**The parent's acceptance finishes its subtasks.** `acceptTaskBusinessArtifact` on a parent moves each subtask held only by `awaiting_parent_aggregation` to `complete`, clearing the Hold. No CEO approval is fabricated for them and their artifacts stay unreviewed. A subtask accepted through a Founder Decision never moves a key result: only the parent's accepted result does.

## Considered options

- **Keep auto-accepting subtasks and exempt them from the risk scan.** Accepting a slice still marks the parent's key result and makes the slice consumable by anyone. The acceptance itself is the wrong event.
- **Loosen the scheduler to accept `review` plus Proof everywhere.** Makes the rules agree by making the ordinary one wrong: a task outside the parent would consume unaccepted work, and a failed or superseded verification would pass.
- **Hide subtasks from CEO Office by `taskKind` in the projection.** Treats the symptom on one surface while the Hold, the guard and readiness all still say a CEO decision is owed.

## Consequences

- Both delivery entry points are tested against the same outcome matrix, and a subtask's Founder Decision is tested through its lifecycle — surfaced and blocking, picked (siblings resume, key result untouched), and returned (the subtask requeues) — from both.
- A normal subtask chain runs to parent aggregation with no CEO involvement, and the parent is not queued and re-parked.
- Existing subtasks already holding an `awaiting_ceo_review` Hold are not migrated, and no recovery procedure is provided: companies created before this change are discarded by deleting the `.auto-crop` state and created again. Internal readiness treats that Hold as blocking, and approving such a subtask in CEO Office would not help either: a pre-contract verification report carries no verdict, so approval would accept a report that says verification failed.
- Known limitations:
