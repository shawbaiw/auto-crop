# Dependency Cascade Plan

## Goal

Make task handoffs feel continuous after CEO Office accepts upstream Proof.

The immediate failure mode is a cross-department dependency such as Growth waiting on Engineering's `Validate the prototype locally` task. If Engineering first reports without Proof, Growth remains blocked. When Engineering later submits Proof and CEO Office approves it, Growth should automatically move from dependency-blocked to `queued` without the user clicking Refresh.

## Canonical Term

Use **Dependency Cascade** for the runtime mechanism that re-evaluates direct downstream tasks after an upstream task's Proof is accepted by CEO Office.

Dependency Cascade is not task execution. It only maintains dependency-derived task state. The scheduler remains responsible for starting queued tasks.

## First-Version Acceptance Criteria

CEO Office approves an Engineering task with Consumable Proof. A direct Growth task that was blocked only because of that Engineering dependency is automatically updated to `queued`, and the dashboard reflects the update without a manual Refresh action.

## Decisions

- Trigger Dependency Cascade only after a CEO approve decision.
- Require the approved task to have Consumable Proof.
- Evaluate each direct consumer against all of its Task Dependencies.
- Move only dependency-blocked tasks to `queued`.
- Treat `blocked` and `waiting_dependency` as cascade-eligible states.
- Do not rewrite `queued`, `review`, `running`, `complete`, `failed`, `cancelled`, or `needs_replan` tasks.
- Do not recover tasks whose failure reason is unrelated to dependencies.
- Reuse Dependency Readiness rules for downstream evaluation.
- Keep execution separate: Dependency Cascade must not call or bypass the scheduler.
- Make the cascade idempotent: if task status and dependency note are unchanged, do not write duplicate events.
- Publish cascade events over SSE for other open dashboard views.
- Extend the CEO review decision API response with cascade results so the initiating UI can update immediately.
- If cascade propagation partially fails, keep the CEO approval successful and surface a non-blocking warning.
- Document the next-version direction even though the first version is intentionally direct-consumer only.

## Runtime Scope

Add a small runtime module, likely `apps/server/src/runtime/dependencyCascade.ts`.

The module should expose a service with a shape similar to:

```ts
propagateDependencyCascade({
  repositories,
  sourceTaskId,
  maxDepth: 1,
  now,
  createId,
});
```

The first implementation should run with depth 1 only. The interface may carry `maxDepth` and visited-task protection so later recursive propagation does not require a conceptual rewrite.

For each direct consumer:

1. Skip the consumer unless it is `blocked` or `waiting_dependency`.
2. Skip dependency-blocked candidates whose current failure reason is unrelated to dependency readiness.
3. Resolve Dependency Readiness using all dependencies of the consumer.
4. If ready, update the consumer to `queued`, clear dependency failure fields, and write `dependency_ready`.
5. If still waiting or blocked and the status or dependency note changes, update the consumer and write the existing appropriate dependency event.
6. If nothing changes, return no event for that consumer.

The existing manual refresh path should share the same lower-level readiness-to-task-state logic, but Dependency Cascade should not invoke Proof Recovery.

## API Response

Extend successful CEO approve responses with:

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

The response should include only tasks and events actually changed by the cascade. If no consumer changes, return an empty cascade result or omit the field consistently.

The API should publish cascade events over SSE after writing them.

## Dashboard Scope

When CEO Office approves a task:

1. Update the approved task from the existing response.
2. Upsert `dependencyCascade.updatedTasks`.
3. Append `dependencyCascade.events` and `dependencyCascade.progressEvents`.
4. Show a non-blocking warning if `dependencyCascade.errors` is present.

The task graph should reflect the new status. Long-lived node labels should not mention cascade mechanics. Activity or progress entries may say that a task was queued after upstream approval.

## Non-Goals For The First Version

- No recursive cascade beyond direct consumers.
- No parent task or department subtask aggregation.
- No trigger from task refresh, task recovery, Proof Recovery, replan confirmation, or follow-up task approval.
- No direct scheduler wakeup or scheduler invocation.
- No restoration of non-dependency failed tasks.
- No automatic execution outside the scheduler.

## Next-Version Direction

The next scoped plan is [Dependency Cascade Trigger Expansion](dependency-cascade-trigger-expansion-plan.md). It focuses on replan confirmation as the next trigger and shared readiness writing, not recursive cascade or parent aggregation.

After the direct-consumer path is stable, extend the same concept in these directions:

- **Bounded recursive cascade:** allow propagation through longer dependency chains using `maxDepth` and visited-task protection.
- **More trigger points:** invoke Dependency Cascade after task recovery, Proof Recovery approval, replan confirmation, and follow-up task approval.
- **Parent aggregation:** define a separate rule for parent tasks that wait on department subtasks, including whether and when a parent can move to `queued` or `review`.
- **Scheduler wakeup:** optionally wake the scheduler after a successful cascade if waiting for the normal scheduler interval feels too slow, while keeping cascade separate from task execution.

## Test Plan

- API integration: CEO approve an upstream task with Proof; assert a direct dependency-blocked consumer becomes `queued` and the response contains the cascade update.
- API integration: a consumer with another missing dependency remains blocked or waiting.
- API integration: a non-dependency failed consumer is not changed.
- API integration: repeated cascade calls do not duplicate events when no state changes.
- Dashboard test: approving a proof-backed task updates the downstream task graph without clicking Refresh.
