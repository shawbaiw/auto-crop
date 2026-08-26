# Dependency Cascade Trigger Expansion Plan

## Status

Implemented for replan confirmation and shared readiness writing. The follow-on bounded recursive propagation work is tracked in [Bounded Recursive Dependency Cascade Plan](dependency-cascade-recursive-plan.md).

## Goal

Extend Dependency Cascade beyond CEO approval by handling the next concrete continuity gap: replan confirmation changes dependency edges, but affected downstream tasks should not require a manual Refresh to understand the new dependency path.

The next version should make `POST /api/replan-proposals/:id/confirm` automatically re-evaluate affected consumers after dependency rewiring. It should also extract shared readiness writing so manual refresh, CEO approval cascade, and replan confirmation refresh apply Dependency Readiness outcomes consistently.

## First-Version Acceptance Criteria

After confirming a replan proposal, a downstream consumer that used to be blocked by the source task's `needs_replan` state is automatically updated to wait on the final replacement task. The dashboard task graph shows the new dependency edge and the updated waiting state without the user clicking Refresh.

## Decisions

- Scope this version to replan confirmation and shared readiness writing.
- Do not implement recursive cascade in this version.
- Do not implement parent task or department subtask aggregation.
- Do not wake or call the scheduler from cascade logic.
- Do not bypass CEO approval or treat recovered Proof as accepted Proof.
- Keep Proof Recovery and Task Recovery from unlocking downstream consumers directly.
- Treat replan confirmation as dependency rewiring, not as accepted deliverable completion.
- Record affected consumers before dependency replacement occurs.
- After replacement, refresh affected consumers themselves.
- Do not model replan confirmation as propagation from the final replacement task, because that task has not produced accepted Proof yet.
- Return a `dependencyCascade` result from replan confirmation using the same response shape as CEO approval.
- Allow `dependencyCascade.updatedTasks` to include tasks whose summary changed only because dependency edges changed, even when no task event was written.
- Keep `CONTEXT.md` unchanged unless a new domain term emerges; this plan uses existing terms.
- Do not add a new ADR for this version unless implementation uncovers a harder-to-reverse trade-off.

## Runtime Scope

### Shared Readiness Writer

Extract the lower-level operation that turns a Dependency Readiness result into durable task state:

- task status
- task execution summary
- task event when status, failure fields, or dependency note changes
- task progress event when a user-facing progress explanation is warranted

Manual refresh and Dependency Cascade should use the same readiness-to-state behavior. Proof Recovery should remain a refresh-specific pre-step and should not move into the shared writer.

The writer should support:

- `ready` -> `queued`, clear dependency failure fields, write `dependency_ready`
- `waiting` -> `waiting_dependency`, update dependency note, write `dependency_waiting` only when meaningful state changed
- `missing_deliverable` -> `blocked`, set `missing_deliverable`, write `deliverable_missing` only when meaningful state changed
- `blocked` -> `blocked`, set `dependency_failed` or `needs_replan`, write `task_blocked` only when meaningful state changed

Idempotency remains required: unchanged task status and dependency details should not produce duplicate events.

### Replan Confirmation

Before confirming a replan proposal, record the consumers that currently depend on the source task. These are the affected consumers for this operation.

After confirmation:

1. Create the replacement tasks.
2. Rewire affected consumers from the source task to the final replacement task.
3. Re-evaluate each affected consumer against all of its current dependencies.
4. Return updated affected consumer summaries, including current `dependsOnTaskIds`.
5. Write task/progress events only when state meaningfully changes.

This is a batch refresh of affected consumers, not a cascade from the final replacement task.

## Eligible Consumer States

Replan confirmation may rewrite affected consumers in:

- `blocked`
- `waiting_dependency`

For `blocked` consumers, only dependency-related reasons are eligible:

- `dependency_failed`
- `missing_deliverable`
- `needs_replan`

Do not restore consumers whose own task status is `needs_replan` or `failed`. A `blocked` consumer with `latestFailureReason === "needs_replan"` can be refreshed because the source dependency required replanning; a consumer whose own `status === "needs_replan"` requires its own replan flow.

If an affected consumer is already `queued`, include its updated task summary so the dashboard dependency graph can update edges, but do not write a task event solely for that unchanged state.

## API Response

Extend successful `POST /api/replan-proposals/:id/confirm` responses:

```ts
{
  proposal: ReplanProposalSummary;
  sourceTask: TaskSummary;
  createdTasks: TaskSummary[];
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

The `dependencyCascade` shape should match CEO approval. `updatedTasks` and `events` do not need to be one-to-one because dependency edge updates can require a UI patch without producing an activity event.

If refreshing one affected consumer fails, keep replan confirmation successful and return the failure in `dependencyCascade.errors`.

## Dashboard Scope

When confirming a replan proposal:

1. Keep the existing update of proposal/source/created tasks.
2. Upsert `dependencyCascade.updatedTasks`.
3. Append `dependencyCascade.events`.
4. Append `dependencyCascade.progressEvents`.
5. Surface `dependencyCascade.errors` through the same non-blocking warning path used by CEO approval cascade.

The CEO Task Dependency Graph should immediately show affected consumers pointing at the final replacement task. If a consumer is waiting on that replacement task, the graph should say it is waiting on the replacement task, not the old source task.

## Non-Goals

- No recursive cascade.
- No parent task or department subtask aggregation.
- No scheduler wakeup.
- No automatic downstream unlock from Proof Recovery.
- No automatic downstream unlock from Task Recovery.
- No automatic approval of recovered Proof.
- No direct execution outside the scheduler.
- No new glossary term unless implementation uncovers a stable domain concept.

## Test Plan

- Runtime unit: shared readiness writer maps `ready`, `waiting`, `missing_deliverable`, and blocked dependency outcomes to task state/events consistently.
- Runtime unit: shared readiness writer is idempotent when status and dependency note do not change.
- API integration: confirming a replan records affected consumers before rewiring and returns them with updated `dependsOnTaskIds`.
- API integration: a consumer blocked by source `needs_replan` becomes `waiting_dependency` for the final replacement task after confirm.
- API integration: a queued affected consumer is returned as an updated task summary without writing a dependency event.
- API integration: consumer refresh failures appear in `dependencyCascade.errors` without rolling back replan confirmation.
- Dashboard test: confirming a replan updates the task graph to show the affected consumer waiting on the final replacement task without manual Refresh.
