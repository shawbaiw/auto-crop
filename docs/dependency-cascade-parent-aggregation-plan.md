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

A parent task was split into department subtasks and is waiting on them. When the final required subtask reaches an accepted proof-backed completion state, the parent task automatically moves out of stale `waiting_dependency` state. The dashboard parent flow reflects the new parent state without a manual Refresh action.

## Decisions To Make

- Define whether subtask completion requires CEO Office approval, department-local proof, or a narrower accepted-proof rule.
- Decide whether the parent should move to `queued` for proof summarization or directly to `review` when all subtasks are complete.
- Decide how failed, blocked, `needs_replan`, or missing-proof subtasks aggregate onto the parent.
- Decide whether aggregation should use the existing Dependency Readiness writer, a sibling parent aggregation writer, or a thin wrapper over both.
- Decide which events and progress events are user-facing enough to write when parent state changes.

## Initial Scope

- Handle parent tasks whose dependencies are department subtasks.
- Trigger after subtask completion or CEO approval of a subtask deliverable.
- Keep aggregation bounded to one parent and its direct subtasks.
- Update parent task status, dependency note, task event, and parent progress flow when the aggregate state meaningfully changes.
- Return updates through the existing API response or SSE path used by the triggering action.

## Non-Goals

- No recursive parent trees beyond CEO parent task to department subtask.
- No scheduler wakeup in the first aggregation pass.
- No automatic execution or proof generation from the aggregation writer.
- No default dashboard exposure of subtask proof.
- No new generalized workflow engine.

## Test Plan

- Runtime unit: all required subtasks complete with accepted proof moves the parent to the chosen next state.
- Runtime unit: a waiting subtask keeps the parent in `waiting_dependency` with a useful dependency note.
- Runtime unit: a blocked or `needs_replan` subtask blocks the parent with the right failure reason.
- Runtime unit: repeated aggregation is idempotent when parent state and notes do not change.
- API integration: completing or approving the final subtask returns/publishes the parent update.
- Dashboard test: the department parent flow updates after subtask aggregation without manual Refresh.
