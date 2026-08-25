# CEO Task Dependency Graph Plan

## Goal

Replace the CEO Workspace's flat first-task overview with a task relationship view that shows which department owns each first task, how tasks depend on each other, what is blocked, and where the user should inspect next.

The graph should make the CEO Workspace feel like an execution map instead of a plain task list. It should not replace department progress flows.

## Decisions

- The feature is called the CEO Task Dependency Graph.
- It renders only CEO-assigned parent tasks from the company task graph.
- It draws only real `Task Dependency` relationships from persisted dependency data such as `dependsOnTaskIds`.
- It does not infer dependencies from task order, task title, progress events, or follow-up wording.
- It uses a department swimlane layout on desktop so department ownership and upstream/downstream relationships are visible together.
- On narrow screens, it degrades to a vertical dependency chain/list where each node still shows its owning department.
- It replaces the current flat first-task overview in the CEO Workspace.
- It lives inside the CEO conversation/report area, after the CEO Intake progress section.
- Founder Vision and objectives remain contextual text above the graph; they are not rendered as graph nodes.
- The first version is read-only. It does not support dragging, editing dependencies, changing task owners, or approving work directly inside the graph.
- Tasks with no recorded dependency relationship are shown in a separate unlinked-task area, not forced into the main graph.
- No ADR is needed for this pass because the feature is a UI projection over existing Task Dependency semantics, not a new persistence or scheduling decision.

## User-Facing Shape

Desktop should use department swimlanes:

```text
Research          Product           Engineering                 Growth
────────          ───────           ───────────                 ──────

[01] Find SEO  →  [02] Define MVP → [03] Build prototype  →     [05] SEO launch
     Completed        Completed         Completed                     Waiting on task 04
                                            ↓
                                      [04] Validate locally
                                           Running
```

If a task has multiple upstream dependencies, the node should highlight only the current unfinished blocker in its default state:

```text
Task 05: Prepare SEO launch and indexing assets
Growth
Waiting on task 04: Validate prototype locally
Also depends on: 01, 02
```

Unlinked tasks should appear below the main graph:

```text
Unlinked Tasks
These tasks do not have a recorded upstream relationship yet.

Task 07: Continue from Partial Output
Engineering
Complete
```

## Status Language

Do not expose raw task status values in the graph. Use user-facing status labels:

- `complete`: `已完成`
- `running`: `执行中`
- `waiting_dependency`: `等待上游`
- `review`: `需要处理`
- `blocked`: `受阻`
- `failed`: `失败`
- `queued`: `等待中`
- `needs_replan`: `需要重新规划`

When a task is waiting on upstream work, show the unfinished blocker in plain language, such as `等待任务04` or `等待上游：Validate prototype locally`.

When a task needs CEO Office action, show `需要处理` and a `查看任务` action.

## Interaction Rules

- Clicking a task node should switch to the owning Department Workspace.
- If the current implementation can focus the task without adding a new anchoring system, it may focus the task; otherwise, switching department is enough for the first version.
- For a task waiting on upstream work, the upstream task reference should be clickable and should navigate to the upstream task's owning department.
- For a task that needs CEO Office action, `查看任务` should keep the user in CEO Workspace and bring the CEO pending item into view when that behavior is already available.
- Approval and return actions stay in CEO Pending. The graph does not duplicate approval controls.

## Data Rules

- Use task `dependsOnTaskIds` as the source of graph edges.
- Use task department ownership as the source of swimlane placement.
- Use current task state as the source of graph status.
- Use CEO pending derivation only to decide whether a task should show the `查看任务` action.
- Do not use department progress events as the source of graph dependencies.
- Do not place tasks without recorded dependencies into the main dependency chain unless they are roots or leaves in the persisted graph.

## Implementation Notes

Prefer small dashboard composition components over a new graph framework.

Suggested frontend structure:

- Add a `CeoTaskDependencyGraph` composition component near the CEO Workspace code.
- Extract small helpers for:
  - user-facing task status labels
  - dependency graph roots and children
  - unfinished upstream blockers
  - unlinked tasks
- Reuse existing retro visual treatment and current department icons.
- Keep node labels compact and avoid a dense task-management table.
- Avoid adding graph editing state.

## Implementation Order

1. Update dashboard tests to describe the desired CEO graph behavior before implementation.
2. Add graph helper functions for dependency lookup, root/child grouping, blocker detection, and unlinked-task detection.
3. Replace the flat CEO first-task overview with `CeoTaskDependencyGraph`.
4. Render desktop department swimlanes and narrow-screen vertical fallback using CSS.
5. Add `查看任务` for review/CEO-pending tasks without duplicating approve or return controls.
6. Add click behavior from graph tasks to their owning department workspace.
7. Add unlinked-task rendering below the main graph.
8. Verify that objectives remain contextual and are not graph nodes.

## This Version Does Not Do

- No editing dependencies.
- No drag-and-drop layout.
- No graph database or new persistence.
- No inferred dependency generation.
- No display of department subtasks by default.
- No approval or return controls inside graph nodes.
- No replacement of Department Workspace progress flows.

## Verification

- Dashboard tests confirm the CEO Workspace renders a task relationship graph instead of the old first-task list.
- Dashboard tests confirm each graph node shows task title, owning department, and user-facing status.
- Dashboard tests confirm waiting tasks show their unfinished upstream blocker.
- Dashboard tests confirm tasks with multiple upstream dependencies do not hide the active blocker.
- Dashboard tests confirm unlinked tasks are shown separately.
- Dashboard tests confirm clicking a node selects the owning department workspace.
- Dashboard tests confirm `查看任务` appears for CEO-pending tasks without rendering approve/return controls in the graph.
- Dashboard tests confirm narrow-screen fallback keeps department ownership visible.

Run:

```bash
pnpm --filter @auto-crop/dashboard test
pnpm --filter @auto-crop/dashboard typecheck
pnpm typecheck
```
