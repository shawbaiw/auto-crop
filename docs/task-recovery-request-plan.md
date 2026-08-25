# Task Recovery Request Plan

## Goal

Make failed, timed-out, or stale running tasks restartable without weakening the Proof gate. The user-facing action is **Recover Task**. The domain term is **Task Recovery Request**.

## Decisions

- Stale running tasks are tasks whose latest running agent run has exceeded its Effective Timeout without a finished outcome.
- Stale running tasks should be reconciled to `failed` with failure reason `timeout`.
- The UI should show stale-timeout failures as "timed out, waiting for recovery" rather than only "failed".
- `POST /api/tasks/:id/recover` should handle Task Recovery Requests. Do not overload task refresh with task restart semantics.
- Scheduler tick and company-state reads should both reconcile stale running tasks.
- Reconciliation should mark the stale `agent_run` as `failed`, set `finished_at`, clear the task lock, append a `task_failed` event, and append a department progress event.
- Recover Task should first attempt controlled Proof Recovery. If Proof is found, the task goes to CEO review and does not rerun.
- If no Partial Output exists, Recover Task should reset the original task to `queued`.
- If Partial Output exists, Recover Task should create a follow-up task displayed as `<original task title> (recovery)` in the UI, keep the original failed task visible, and move downstream dependencies to the follow-up.
- Ordinary timeout recovery does not require CEO approval. Scope-too-large, unclear task definition, wrong direction, and exhausted recovery paths should go to CEO handling/replanning.
- Long-profile timeout recovery is bounded: use existing profile escalation where possible; after long timeout, allow one Partial Output recovery path, then require replanning.
- Recovery task Proof must still go to CEO review before completion.
- Recovery tasks must appear in the CEO Task Dependency Graph in their owning department lane.

## Implementation Steps

1. Add stale running reconciliation in the runtime:
   - Find running agent runs whose `started_at + effective_timeout_ms < now`.
   - Update the agent run to `failed/timeout`.
   - Update the task to `failed`.
   - Persist latest failure reason/message and timeout budget.
   - Delete the task lock.
   - Append `task_failed` and task progress events.

2. Call reconciliation from:
   - Scheduler startup/tick before fetching queued work.
   - Company state read path before returning tasks to the dashboard.

3. Add `POST /api/tasks/:id/recover`:
   - Accept `failed`, `blocked`, `needs_replan`, and stale `running` tasks after reconciliation.
   - First call controlled Proof Recovery.
   - If Proof Recovery succeeds, return the existing review-ready result shape.
   - If no Partial Output exists, requeue the original task.
   - If Partial Output exists, create or reuse one follow-up task and replace downstream dependencies.
   - Return the updated task, any created task, activity event, progress event, proof if recovered, and recovery summary.

4. Update dashboard API client types and UI:
   - Add `recoverTask`.
   - Show **Recover Task** on eligible department task flows and CEO task graph nodes.
   - Add a lightweight confirmation panel before recovery.
   - Show "timed out, waiting for recovery" for `failed/timeout`.
   - Show downstream tasks as waiting on upstream recovery when applicable.

5. Test coverage:
   - Stale running reconciliation marks agent run failed, clears lock, and records events.
   - Company state read reconciles stale running before returning.
   - Recover endpoint requeues a failed timeout task without Partial Output.
   - Recover endpoint creates a follow-up task from Partial Output and rewires downstream dependencies.
   - Recover endpoint attempts Proof Recovery before rerun.
   - Dashboard shows Recover Task in department flows and CEO graph.

## Non-Goals

- Do not auto-complete recovered tasks without CEO review.
- Do not add an unbounded retry loop.
- Do not treat arbitrary workspace files as Proof.
- Do not hide the original failed task when a recovery follow-up exists.
