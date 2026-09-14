# CEO-Owned Department Review Queue

Auto-Crop will make CEO Office the owner of department review decisions. Departments can submit review requests and track their state, but approval and return decisions belong to CEO Office.

The first implementation derives CEO pending review items from existing review-ready tasks instead of adding a complete review-request table. The next implementation will make those derived items actionable by recording durable CEO Review Decisions.

## Considered Options

- **Let departments approve their own review items:** fastest local interaction, but it blurs the boundary between department execution and CEO Office validation.
- **Add a complete CEO review-request data model now:** gives the cleanest long-term state machine, but it requires new persistence, API actions, checkpoint-vs-completion semantics, return reasons, and bidirectional UI synchronization before the immediate UX confusion is solved.
- **Derive CEO pending review items from existing review-ready tasks first:** fixes the visible ownership and navigation problem while keeping the deeper request model as a later, explicit change.
- **Record CEO decisions without request records:** gives CEO Office real approve/return actions and an audit trail while continuing to derive pending requests from existing task state.
- **Use task events only for CEO decisions:** avoids a new table, but makes approval/return history harder to query, serialize, and reason about in company snapshots.

## Decision

CEO Office owns approval and return decisions for department-submitted work.

The domain has two distinct department-to-CEO request types:

- **CEO Review Request:** a department asks CEO Office to approve or return work after execution. A checkpoint request returns the task to execution when approved; a completion request completes the task when approved.
- **CEO Reassignment Request:** a department asks CEO Office to clarify, split, replan, or reassign a task before or during execution. This is not a review request because no deliverable is being approved.

For the first implementation, dashboard UI should derive CEO pending review items from existing parent tasks in `review` state and existing department progress events such as `awaiting_review`. Department pages should stop implying that review happens inside the department. They should say the parent task has been submitted to CEO Office and provide a route to the CEO pending item. The CEO Workspace should show a single CEO pending queue with review items and reassignment items differentiated by type.

The first implementation will not add approve/return buttons. It should show a `View Task` action for each pending item.

The next implementation will add durable `CEO Review Decision` records and `POST /api/ceo-review-decisions`. It will not add durable `CEO Review Request` records yet. Pending review items will continue to be derived from parent tasks with `task.status === "review"`, and every derived pending item will be treated as a completion review request in this phase.

Later Parent Task Aggregation work added an explicit exception for `department_subtask` records: they may reach `review` with Proof as internal aggregation inputs, but they must not appear in CEO Pending. CEO Office reviews the parent-level Proof after parent summarization.

Approval will mark the task complete, write a CEO Review Decision, write a task event, and reuse the existing proof/key-result update behavior when a key result is linked. Return will write a CEO Review Decision, write a task event, move the task back to `queued`, and add a department progress event telling the department that CEO Office returned the task and it is waiting for rework.

CEO Office cannot approve a review item without checkable proof. Missing-proof items may still appear in CEO Pending, but the UI should explain that they cannot pass yet and should allow `View Task` and `Return to Department`, not approval.

The API must reject stale decisions when the task is no longer in `review`, and must reject approve decisions when proof is missing. Return decisions require a structured reason and may include an optional note.

This change does not modify `runCompanyReview`. CEO Review Decisions are direct task-level decisions, while company review remains a separate workflow.

## Consequences

The UI becomes clearer without forcing a premature full request model. Users can see who owns review decisions, where to go when a department is waiting for CEO Office, and what action CEO Office can take next.

Adding CEO Review Decision records gives the product an audit trail for approve/return actions and lets agents include CEO decisions in Company State Snapshot.

The model intentionally remains incomplete. Future work still needs durable `CEO Review Request` and `CEO Reassignment Request` records, explicit checkpoint-vs-completion request state, checkpoint approval that continues execution without completing the task, and a first-class reassignment flow. Until then, the derived pending queue must be treated as a transitional projection, not the final review model.

## Amendment (2026-09-14): The pending queue derives from Task Holds, not from task status

ADR 0020 supersedes two rules above. Both said the same thing in different places — that `task.status === "review"` is what makes a CEO decision pending — and the implementation drifted from it on the CEO Office side, which is how a task ended up being offered for approval while the API refused the decision as stale:

- **Paragraph 28** ("Pending review items will continue to be derived from parent tasks with `task.status === "review"`"): pending items now derive from an open `awaiting_ceo_review` Task Hold. In the common case the two agree, because entering `review` opens that Hold and leaving `review` resolves it in the same write. They differ exactly where it matters: a task moved out of `review` by any other path stops being offered immediately, and a Business Artifact that still reads `unreviewed` on such a task does not resurrect the offer.
- **Paragraph 36** ("The API must reject stale decisions when the task is no longer in `review`"): the guard now asks whether the task currently offers the `ceo_review_decision` Resume Affordance — the same computation that decided whether to offer it. A rejection carries the task's current affordances so the founder is redirected to a real next action rather than handed a dead end.

The proof and Business Artifact preconditions in paragraphs 32, 34, and 36 are unchanged: approval still requires checkable proof and an approvable current artifact.

The transitional nature of the model is unchanged too. Holds replace status as the source of "a decision is owed"; they are not the durable `CEO Review Request` record this ADR still calls for. A future request model should own the checkpoint-vs-completion distinction, with the Hold pointing at the request as its subject.
