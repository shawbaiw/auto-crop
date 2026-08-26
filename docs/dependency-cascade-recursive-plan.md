# Bounded Recursive Dependency Cascade Plan

## Status

Implemented for CEO approve decisions with `maxDepth: 2`, breadth-first traversal, visited-task protection, partial-failure reporting, and dashboard consumption through the existing `dependencyCascade` response shape. The current selected next scope is [Parent Task Aggregation After Department Subtasks](dependency-cascade-parent-aggregation-plan.md).

## Goal

Make dependency-derived task state stay coherent across short downstream chains after CEO Office accepts upstream Proof.

The first Dependency Cascade implementation updates only direct consumers. That fixes the immediate handoff gap, but longer dependency chains can still show stale blocker text. In a chain such as `A -> B -> C`, approving `A` can queue `B`; `C` should then be refreshed enough to say it is waiting on `B`, without implying that `C` is ready to run before `B` has Consumable Proof.

## Canonical Term

Use **Bounded Recursive Cascade** for Dependency Cascade propagation that may continue through downstream Task Dependency chains up to a fixed depth while preventing repeated visits to the same task.

Depth counts consumer hops from the source task. Direct consumers are depth 1. Consumers of those consumers are depth 2. The source task itself is not counted.

## First-Version Acceptance Criteria

CEO Office approves task `A` with Consumable Proof in a chain `A -> B -> C`. `B` was dependency-blocked only by `A`, so it moves to `queued`. Because `B` changed to `queued`, the cascade refreshes `C` at depth 2. `C` is updated to `waiting_dependency` with a dependency note that points at `B`, and the dashboard reflects both updates without a manual Refresh action.

## Preconditions

These trigger-expansion test gaps were closed before recursive propagation was implemented:

- API integration: confirming a replan with an already-`queued` affected consumer returns the consumer with updated `dependsOnTaskIds` and writes no dependency event.
- API integration: a consumer refresh failure during replan confirmation appears in `dependencyCascade.errors` without rolling back the replan confirmation.
- Runtime unit: `refreshDependencyTasks` maps `ready`, `waiting`, `missing_deliverable`, and blocked Dependency Readiness outcomes to durable state and events consistently.
- Runtime unit: `refreshDependencyTasks` is idempotent when task status and dependency details are unchanged.

## Decisions

- Scope the first recursive version to CEO approve decisions only.
- Keep replan confirmation as a batch refresh of affected consumers, not recursive propagation from the final replacement task.
- Use `maxDepth: 2` for CEO approve propagation.
- Clamp any requested `maxDepth` above 5 to 5.
- Treat depth 1 as direct consumers of the approved source task.
- Traverse breadth-first by depth.
- At each depth, merge candidates by task ID and refresh each task at most once.
- Continue from a refreshed task only when that task changes to `queued`.
- Write and return waiting or blocking updates at the current depth, but do not continue recursion from them.
- Keep cascade-eligible states limited to `blocked` and `waiting_dependency`.
- Do not rewrite `queued`, `review`, `running`, `complete`, `failed`, `cancelled`, or `needs_replan` tasks during CEO approve cascade.
- Use visited-task protection so cycles or converging paths cannot refresh the same task repeatedly.
- If refreshing a task fails, stop that branch, continue other branches, and return the failure in `dependencyCascade.errors`.
- Do not report reaching `maxDepth` as an error or warning.
- Keep execution separate: recursive cascade must not wake, call, or bypass the scheduler.
- Do not introduce new dashboard behavior. The dashboard should continue consuming `dependencyCascade.updatedTasks`, `events`, `progressEvents`, and `errors`.

## Runtime Scope

Extend `propagateDependencyCascade` so it performs a bounded breadth-first traversal from `sourceTaskId`.

The runtime should clamp depth before traversal:

```ts
const requestedDepth = input.maxDepth ?? 1;
const maxDepth = Math.min(Math.max(requestedDepth, 0), 5);
```

For each depth:

1. List direct dependency consumers of the current frontier tasks.
2. Remove already visited task IDs and duplicate candidate task IDs.
3. Refresh each candidate through the shared Dependency Readiness writer.
4. Append any changed task update, task event, progress event, or error to the cascade result.
5. Add only candidates that changed to `queued` to the next frontier.

The traversal should preserve breadth-first result ordering: all depth-1 updates before depth-2 updates.

If a task is already `queued` when reached, do not include it in `updatedTasks` solely because it was reached. Unlike replan confirmation, CEO approve recursive cascade does not rewrite dependency edges, so unchanged queued summaries do not need to patch the dashboard.

## API Scope

Change the CEO review decision route to call:

```ts
propagateDependencyCascade({
  repositories,
  sourceTaskId,
  maxDepth: 2,
  now,
  createId,
});
```

Keep the existing response shape:

```ts
{
  dependencyCascade?: {
    updatedTasks: TaskSummary[];
    events: ServerEvent[];
    progressEvents: TaskProgressEventSummary[];
    errors?: Array<{
      taskId: string;
      message: string;
    }>;
  };
}
```

The response order should match runtime breadth-first order. Partial failures remain non-blocking: CEO approval succeeds even when a branch of cascade propagation fails.

## Dashboard Scope

No new dashboard behavior is required.

When CEO Office approves a task, the dashboard should continue to:

1. Update the approved task from the existing response.
2. Upsert `dependencyCascade.updatedTasks`.
3. Append `dependencyCascade.events`.
4. Append `dependencyCascade.progressEvents`.
5. Surface `dependencyCascade.errors` through the existing non-blocking warning path.

Long-lived node labels should not mention recursive cascade mechanics.

## Non-Goals

- No recursive propagation from replan confirmation in this version.
- No new trigger points beyond CEO approve.
- No parent task or department subtask aggregation.
- No scheduler wakeup.
- No automatic downstream unlock from Proof Recovery or Task Recovery.
- No automatic approval of recovered Proof.
- No direct execution outside the scheduler.
- No dashboard panel, badge, or label for recursive cascade mechanics.

## Test Plan

- Runtime unit: depth 1 preserves existing direct-consumer behavior.
- Runtime unit: `maxDepth: 2` refreshes a second-level consumer after the first-level consumer changes to `queued`.
- Runtime unit: waiting or blocked updates are returned but do not continue propagation.
- Runtime unit: duplicate candidates reached through converging paths are refreshed once per cascade.
- Runtime unit: cycles are stopped by visited-task protection.
- Runtime unit: requested depth above 5 is clamped.
- Runtime unit: a failure in one branch stops that branch, continues other branches, and returns `dependencyCascade.errors`.
- API integration: CEO approve in `A -> B -> C` returns breadth-first updates for `B` then `C`.
- API integration: unchanged queued downstream tasks are not returned solely because they were reached.
- Dashboard test: CEO approve updates a depth-2 task's dependency note without manual Refresh.
