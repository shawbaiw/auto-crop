# CEO-Owned Review Queue Plan

## Goal

Remove the ambiguity around department tasks that are "awaiting review." A user should understand that departments submit work to CEO Office, CEO Office owns the review decision, and the department is waiting for CEO Office rather than reviewing itself.

This first phase is a UI and state-projection improvement. It does not add the complete CEO Review Request state machine.

## Decisions

- CEO Office is the only owner of approval and return decisions.
- Departments can submit and track CEO Review Requests, but do not approve their own work.
- A checkpoint CEO Review Request returns the task to execution when approved.
- A completion CEO Review Request completes the task when approved.
- If a department determines that a task needs clarification, splitting, replanning, or reassignment, that is a CEO Reassignment Request rather than a CEO Review Request.
- CEO Workspace should show one "CEO Pending" queue. Items can be review requests or reassignment requests.
- Department pages should show status plus navigation to the CEO pending item, not approval controls.
- First implementation derives CEO pending review items from existing `task.status === "review"` tasks and existing progress events.
- First implementation uses `View Task` as the CEO pending item action. It does not show fake or disabled approve/return buttons.

## User-Facing Flow

Department task flow should avoid the ambiguous label:

```text
Task (Validate the prototype) awaiting review
```

Use a CEO-owned label instead:

```text
Task (Validate the prototype) submitted to CEO Office for review
View CEO Pending Item
```

The `View CEO Pending Item` action should select the CEO Workspace and bring the CEO pending queue into view.

CEO Workspace should include a pending queue that reads like a CEO control surface:

```text
CEO Pending

Review request from Engineering
Validate the prototype
View Task

Reassignment request from Product
Task scope is unclear
View Task
```

For this first phase, the queue can contain only derived review items if reassignment requests do not yet have durable records.

## First-Phase Implementation Scope

### Dashboard

- Add a CEO Pending section inside the CEO Workspace conversation/report area.
- Derive pending review items from tasks whose status is `review`.
- Include department name, task title, and request type.
- Add a `View Task` action for each pending item.
- Update department progress labels for `awaiting_review` and review-status execution labels to say the task was submitted to CEO Office for review.
- Add a department-side navigation action such as `View CEO Pending Item`.
- Clicking the department-side action selects the CEO role in the Department Workspace.
- Keep approve/return buttons out of this phase.

### Runtime And API

- Do not add new persistence tables in this phase.
- Do not add approve/return API actions in this phase.
- Continue using existing task status and progress events as the projection source.
- Preserve the existing Proof gate: tasks need recorded Proof before they can be meaningfully review-ready.

### Copy

Use "CEO Office review" when referring to review ownership. Avoid plain "awaiting review" in department-facing flow labels because it hides who owns the next action.

Use `View Task` in CEO Workspace. Use `View CEO Pending Item` or equivalent wording in the department flow when the user needs to navigate back to CEO Office.

## Future Scope

- Add durable `CEO Review Request` records.
- Add durable `CEO Reassignment Request` records.
- Add approve and return actions owned by CEO Office.
- Require structured return reasons:
  - needs changes
  - unclear task definition
  - scope too large
  - wrong direction
- Model checkpoint review and completion review explicitly.
- Synchronize approved checkpoint reviews back to department execution.
- Synchronize approved completion reviews to task completion.
- Show returned requests in department progress with the selected return reason.

## Verification

- Dashboard tests confirm department review labels name CEO Office as the owner.
- Dashboard tests confirm review-ready tasks appear in the CEO Pending section.
- Dashboard tests confirm department-side navigation selects CEO Workspace.
- Dashboard tests confirm CEO Pending items show `View Task` rather than approve/return controls.
- Typecheck and lint remain clean.

Run:

```bash
pnpm --filter @auto-crop/dashboard test -- src/App.test.tsx --runInBand
pnpm typecheck
pnpm lint
```
