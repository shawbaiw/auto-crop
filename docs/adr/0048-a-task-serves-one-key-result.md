# A Task Serves One Key Result

Status: accepted

Every planned task names the one key result it serves. A key result is met when every task serving it is complete. CEO Office shows the goals and key results with the plan, keeps them in view on the Plan tab, and posts a card when a key result is met.

## Context

The blueprint had no way to say which key result a task serves, so the writer filed every task under the first key result. A second goal or key result never had a task. It never progressed and never got an Objective Stage Change. The Task Brief card showed the first goal on every task.

Progress was also wrong for the first key result. Each accepted task set its key result to `met` and overwrote its current value with `accepted_business_artifact`. The first accepted task met the key result whatever was still open.

CEO Office had no place for goals after the workbench redesign (dashboard ADR 0002), and the plan card listed only tasks.

## Decision

- **The link is declared.** Each key result in a blueprint has a `key`. Each task names a `keyResultKey`, and the parser refuses an unknown or repeated key. A task a CEO Intake plans names a `keyResultId` of the company (ADR 0046). A Split's replacements serve the key result of the task they replace. Department subtasks do not count toward a key result; their parent does.
- **Met is derived from tasks.** A key result is `met` when every planned task serving it is `complete`, and `active` while any is not or before it has a task. Cancelled tasks and department subtasks do not count. `applyTaskTransition`, the only status writer, settles the key result whenever a task's status changes, and a CEO Intake settles it when it adds a task. The runtime never writes the key result's current value: that value is the plan's measure.
- **CEO Office shows the goals.**
  - The plan card names the goals and key results the plan serves. Its detail reads goal → key result → the tasks that serve it.
  - A `key_result_met` card is posted when the last task serving a key result completes. It is a projection, dated by that completion (ADR 0019).
  - The Plan tab keeps the goals in view above the canvas: each key result's target, how many of its tasks are done, and whether it is met.
- **No fallback.** Companies created before this change are test data and are deleted. There is no view for a company without a plan snapshot.

## Consequences

- A blueprint that leaves a task without a key result fails to parse, so the Company Creation fails and the founder can retry it.
- `missed` is no longer written by the runtime. A key result is only active or met until a rule for missing one is decided.
- Objective Stage Change, which waits for every task under a goal, now sees every goal's tasks.
