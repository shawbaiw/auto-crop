# CEO-Owned Review Queue Plan

## Goal

Remove the ambiguity around department tasks that are "awaiting review." A user should understand that departments submit work to CEO Office, CEO Office owns the review decision, and the department is waiting for CEO Office rather than reviewing itself.

This plan is split into two phases. The first phase is a UI and state-projection improvement. The next phase makes CEO Office review actionable with durable CEO Review Decisions, while still avoiding a full CEO Review Request table.

## Decisions

- CEO Office is the only owner of approval and return decisions.
- Departments can submit and track CEO Review Requests, but do not approve their own work.
- A checkpoint CEO Review Request returns the task to execution when approved.
- A completion CEO Review Request completes the task when approved.
- If a department determines that a task needs clarification, splitting, replanning, or reassignment, that is a CEO Reassignment Request rather than a CEO Review Request.
- CEO Workspace should show one "CEO Pending" queue. Items can be review requests or reassignment requests.
- Department pages should show status plus navigation to the CEO pending item, not approval controls.
- First implementation derives CEO pending review items from existing parent tasks with `task.status === "review"` and existing progress events.
- First implementation uses `View Task` as the CEO pending item action. It does not show fake or disabled approve/return buttons.
- Next implementation treats derived parent `task.status === "review"` pending items as completion review requests.
- Next implementation adds durable CEO Review Decision records, not durable CEO Review Request records.
- CEO Office can approve completion review requests only when the department has submitted checkable proof.
- CEO Office can return review requests to the department with a structured reason and optional note.
- `runCompanyReview` stays unchanged in this phase.

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
- Derive pending review items from parent tasks whose status is `review`.
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
- Add checkpoint review as a first-class request type.
- Add CEO Reassignment Request actions and department-side reassignment flow.
- Show submitted proof inline when proof rendering is available.
- Model dependencies between department tasks and blocked downstream work.
- Let departments request clarification, splitting, replanning, or reassignment before execution.

## Next Phase: Durable Completion Review Decisions

### Goal

Make the CEO Pending queue actionable without overbuilding the full review-request state machine. A user should be able to open a pending department task, see what the department submitted, approve it, or return it with a clear reason and next step.

This phase uses simpler user-facing language. The UI should explain what the user can do, not expose internal terms like "checkpoint review" unless they become necessary in a later version.

### Data Model

- Add a durable `ceo_review_decisions` table.
- Do not add a `ceo_review_requests` table in this phase.
- Continue deriving CEO pending review items from parent tasks with `task.status === "review"`.
- Treat every derived pending item as a completion review request in this phase.
- Exclude `department_subtask` records from CEO Pending. Department subtasks can reach `review` with Proof as internal parent-aggregation inputs; CEO Office reviews the parent-level Proof after parent summarization.
- Store:
  - task id
  - department id or role
  - decision: approve or return
  - return reason, required for return decisions
  - optional note
  - actor, timestamp, and relevant proof/run metadata when available
- Include CEO Review Decisions in Company State Snapshot so later agents can understand prior CEO approvals and returns.

### API

- Add `POST /api/ceo-review-decisions`.
- Request accepts `taskId`, `decision`, optional `note`, and `returnReason` for returns.
- If the task is not currently in `review`, return `409`.
- If the CEO tries to approve a task without proof, return `409`.
- If the CEO returns a task without `returnReason`, return validation error.

### Decision Effects

Approve:

- Write a CEO Review Decision.
- Write a task event.
- Mark the task complete.
- If the task is linked to a key result, reuse the existing review/proof update behavior so the key result becomes `proof_received` or `met` as appropriate.
- Close the task detail view in CEO Workspace.
- Remove the item from CEO Pending.
- Show a success message at the top of CEO Pending.

Return:

- Write a CEO Review Decision.
- Write a task event.
- Move the task back to `queued`.
- Add a department progress event that says `CEO Office 已退回，等待部门重新处理`.
- Close the task detail view in CEO Workspace.
- Remove the item from CEO Pending.
- Show a success message at the top of CEO Pending.

This phase must not change `runCompanyReview`. CEO decisions are direct task-level decisions, not a replacement for the company-level review runner.

### Return Reasons

Use structured internal values with plain UI labels:

- `needs_changes`: needs changes
- `unclear_task_definition`: task is unclear
- `scope_too_large`: task is too large
- `wrong_direction`: direction is wrong

The UI should show the reason and ask for an optional note. When returning a task, the department should see both why it was returned and what to do next.

### Missing Proof

If a parent department task is in review but has no checkable proof, the task can appear in CEO Pending but cannot be approved. Department subtasks remain excluded from CEO Pending even when they are in `review`.

Show this copy in the task detail:

```text
部门还没有提交可检查的结果，暂时不能通过。你可以退回给部门，让它补充结果或说明。
```

Available actions:

- `查看任务` to inspect the task/run status.
- `退回给部门` to request more results or explanation.

Do not show an enabled approve action when proof is missing.

### CEO Task Detail UI

`View Task` opens an internal CEO Workspace detail view. It should show the most important information first:

- whether the task can pass now
- why it cannot pass, if blocked
- what the task asked the department to do
- what the department submitted
- proof summary, proof type, and proof URI when available
- run status, failure reason, blocker, budget, and recent log summary
- CEO decision controls

Suggested section labels:

- `任务审查`
- `任务内容`
- `部门提交内容`
- `运行情况`
- `CEO 决策`

Suggested actions:

- `通过，标记完成`
- `退回给部门`
- `查看任务`

### Checkpoint Review Boundary

Completion review means the department is asking CEO Office to approve the finished task. Approval marks the task complete.

Checkpoint review means the department needs CEO Office to approve an intermediate choice before continuing. Approval lets the department continue execution and must not mark the task complete.

Checkpoint review is intentionally out of scope for this phase. Do not use checkpoint wording in the UI until checkpoint state exists.

### Verification

- API tests cover approve success, return success, stale-task `409`, and approve-without-proof `409`.
- Dashboard tests cover opening a CEO Pending task detail with `View Task`.
- Dashboard tests cover approval closing the detail and removing the pending item.
- Dashboard tests cover return requiring a reason and showing the reason/next step to the department.
- Dashboard tests cover missing-proof pending items showing `查看任务` and `退回给部门` but not an enabled approve action.
- Company State Snapshot tests cover serialized CEO Review Decisions.
- Existing company review tests remain unchanged because `runCompanyReview` is not modified.

Run:

```bash
pnpm --filter @auto-crop/dashboard test -- src/App.test.tsx --runInBand
pnpm test
pnpm typecheck
pnpm lint
```

## Later Scope

- Add durable `CEO Review Request` records.
- Add durable `CEO Reassignment Request` records.
- Add approve and return actions for checkpoint reviews.
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
