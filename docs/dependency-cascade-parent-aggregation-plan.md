# Parent Task Aggregation After Department Subtasks

## Status

Selected as the next Dependency Cascade-adjacent scope after direct-consumer cascade, replan-confirm refreshes, and bounded recursive cascade.

## Goal

Make parent task state coherent after department subtasks change state.

The current scheduler can split a large parent task into department subtasks and mark the parent as `waiting_dependency`. Once those subtasks finish, the parent should not remain stale until a user manually refreshes or a later scheduler pass happens to repair it. The system needs a focused aggregation rule that decides when the parent task is still waiting, blocked by a subtask, ready to summarize proof, or ready for CEO review.

## Why This Is Next

Parent aggregation is the next highest-leverage scope because it closes a visible continuity gap inside the existing department task flow. It also preserves the execution boundary: Dependency Cascade keeps task dependency state coherent, while the scheduler remains responsible for running work.

Scheduler wakeup can wait until after aggregation rules are durable. Additional trigger points can also wait, because parent/subtask coherence affects the core task model rather than just another event source.

## First-Version Acceptance Criteria

A parent task was split into department subtasks and is waiting on them. When the final required subtask reaches Department Subtask Readiness, the parent task automatically moves out of stale `waiting_dependency` state and back to `queued` so the scheduler can run parent-task proof summarization. The dashboard parent flow reflects the new parent state without a manual Refresh action.

## Decisions

- A department subtask is ready to contribute to its parent when it is in `review` and has recorded Proof. Subtask readiness does not require CEO Office approval.
- When all required department subtasks are ready, move the parent task to `queued` for scheduler-driven parent proof summarization.
- Do not move the parent directly to `review`; aggregation must not generate parent Proof or bypass the scheduler.
- If a subtask is failed, blocked, missing Proof, or `needs_replan`, aggregate that condition onto the parent as a dependency-derived block.
- Trigger aggregation immediately when a department subtask reaches `review` with recorded Proof, including when Proof Recovery produces that state.
- When the parent runs after aggregation queues it, pass all ready department subtask Proof as handoff input for Parent Proof Summarization.
- When aggregation blocks a parent, update the department parent flow with the blocking subtask name and reason, but do not expose subtask Proof by default.
- If a parent has both department subtask dependencies and ordinary Task Dependencies, aggregation must evaluate all dependencies before queuing the parent.
- When aggregation queues a parent, write a `dependency_ready` task event and a `summarizing_proof` progress event.
- Department subtasks in `review` must not appear in CEO Pending; CEO Office reviews the parent-level Proof after Parent Proof Summarization.
- Implement Parent Task Aggregation as a dedicated runtime writer that can reuse lower-level Dependency Readiness logic without making ordinary Dependency Cascade responsible for parent/subtask semantics.
- When a department subtask reaches readiness, refresh all direct dependency consumers of that subtask; each candidate parent then evaluates all of its dependencies before changing state.
- API routes that trigger Parent Task Aggregation should return a `parentAggregation` result with `updatedTasks`, `events`, `progressEvents`, and `errors`.
- Make aggregation idempotent: unchanged parent status and dependency details should not produce duplicate task events, progress events, or `updatedTasks`.
- Keep aggregation-eligible parent states limited to `blocked` and `waiting_dependency`.

## Initial Scope

- Handle parent tasks whose dependencies are department subtasks.
- Trigger after a department subtask reaches `review` with recorded Proof, including through Proof Recovery.
- Keep aggregation bounded to one parent and its direct subtasks.
- Update parent task status, dependency note, task event, and parent progress flow when the aggregate state meaningfully changes.
- Return updates through a `parentAggregation` API response field and publish events over SSE for other open dashboard views.

## Runtime Scope

Add a dedicated runtime module, likely `apps/server/src/runtime/parentTaskAggregation.ts`.

The module should expose a service with a shape similar to:

```ts
propagateParentTaskAggregation({
  repositories,
  sourceSubtaskId,
  now,
  createId,
});
```

For each direct dependency consumer of the ready subtask:

1. Skip the consumer unless it is a parent task.
2. Skip the parent unless its status is `blocked` or `waiting_dependency`.
3. Evaluate all dependencies of the parent.
4. Treat department subtask dependencies as ready when they are in `review` with recorded Proof.
5. Treat ordinary Task Dependencies through existing Dependency Readiness rules.
6. If every dependency is ready, update the parent to `queued`, clear dependency failure fields, write `dependency_ready`, and write `summarizing_proof`.
7. If a dependency is waiting, blocked, missing Proof, or `needs_replan`, update the parent to the corresponding dependency-derived state and write the appropriate task/progress events when state meaningfully changes.
8. If nothing changes, return no event or updated task for that parent.

## API Response

API routes that trigger aggregation should include:

```ts
{
  parentAggregation?: {
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

The initiating UI should upsert `parentAggregation.updatedTasks`, append `events` and `progressEvents`, and surface non-blocking warnings for `errors`. The server should also publish aggregation events over SSE so other open dashboard views update.

## Parent Summarization Input

When Parent Task Aggregation queues a parent, the next scheduler run should provide the parent agent with all ready department subtask Proof as handoff input. The parent agent is responsible for producing parent-level Proof for CEO Office review.

Aggregation itself must not merge Proof, synthesize Proof, or mark the parent as review-ready.

## Dashboard Scope

When a parent is blocked because of a subtask, the department parent flow should name the blocking subtask and show the dependency-derived reason. The default UI should keep subtask Proof hidden, preserving the existing department task progress flow boundary.

Department subtasks that reach `review` are not CEO Pending items. CEO Pending should continue to show the parent task only after Parent Proof Summarization produces parent-level Proof.

## Non-Goals

- No recursive parent trees beyond CEO parent task to department subtask.
- No scheduler wakeup in the first aggregation pass.
- No automatic execution or proof generation from the aggregation writer.
- No default dashboard exposure of subtask proof.
- No new generalized workflow engine.

## Test Plan

- Runtime unit: all required subtasks in `review` with recorded Proof moves the parent to `queued`.
- Runtime unit: a waiting subtask keeps the parent in `waiting_dependency` with a useful dependency note.
- Runtime unit: a blocked or `needs_replan` subtask blocks the parent with the right failure reason.
- Runtime unit: repeated aggregation is idempotent when parent state and dependency details do not change.
- Runtime unit: aggregation does not rewrite ineligible parent statuses such as `queued`, `running`, `review`, `complete`, `failed`, `cancelled`, or `needs_replan`.
- API integration: the final subtask reaching `review` with recorded Proof returns or publishes the parent update.
- Dashboard test: the department parent flow updates after subtask aggregation without manual Refresh.
