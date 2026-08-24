# CEO-Owned Department Review Queue

Auto-Crop will make CEO Office the owner of department review decisions. Departments can submit review requests and track their state, but approval and return decisions belong to CEO Office. The first implementation will derive CEO pending review items from existing review-ready tasks instead of adding a complete review-request table.

## Considered Options

- **Let departments approve their own review items:** fastest local interaction, but it blurs the boundary between department execution and CEO Office validation.
- **Add a complete CEO review-request data model now:** gives the cleanest long-term state machine, but it requires new persistence, API actions, checkpoint-vs-completion semantics, return reasons, and bidirectional UI synchronization before the immediate UX confusion is solved.
- **Derive CEO pending review items from existing review-ready tasks first:** fixes the visible ownership and navigation problem while keeping the deeper request model as a later, explicit change.

## Decision

CEO Office owns approval and return decisions for department-submitted work.

The domain has two distinct department-to-CEO request types:

- **CEO Review Request:** a department asks CEO Office to approve or return work after execution. A checkpoint request returns the task to execution when approved; a completion request completes the task when approved.
- **CEO Reassignment Request:** a department asks CEO Office to clarify, split, replan, or reassign a task before or during execution. This is not a review request because no deliverable is being approved.

For the first implementation, dashboard UI should derive CEO pending review items from existing tasks in `review` state and existing department progress events such as `awaiting_review`. Department pages should stop implying that review happens inside the department. They should say the task has been submitted to CEO Office and provide a route to the CEO pending item. The CEO Workspace should show a single CEO pending queue with review items and reassignment items differentiated by type.

The first implementation will not add approve/return buttons. It should show a `View Task` action for each pending item. Full approval, structured return reasons, checkpoint review, completion review, and durable request entities remain future work.

## Consequences

The UI becomes clearer without forcing a premature data model. Users can see who owns review decisions and where to go when a department is waiting for CEO Office.

Future work still needs durable `CEO Review Request` and `CEO Reassignment Request` records, approval and return actions, structured return reasons, and explicit checkpoint-vs-completion behavior. Until then, the derived pending queue must be treated as a transitional projection, not the final review model.
