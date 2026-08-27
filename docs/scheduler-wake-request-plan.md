# Scheduler Wake Request Plan

## Status

Implemented.

The CLI scheduler loop now exposes a coalesced `requestWake(reason)` hook. API routes request wake through an injected callback when Dependency Cascade or Parent Task Aggregation queues executable work.

## Goal

Reduce the delay between dependency-derived task state changes and the next scheduler tick without letting Dependency Cascade or Parent Task Aggregation execute tasks directly.

When Dependency Cascade or Parent Task Aggregation moves a task to `queued`, the scheduler can already run it on the next normal interval. The continuity gap is that the interval can make the product feel idle even though the runtime already knows new work is ready. A Scheduler Wake Request should ask the scheduler loop to tick sooner while preserving the scheduler boundary.

## Decisions

- Use **Scheduler Wake Request** for the runtime hint that asks the scheduler loop to tick sooner.
- A Scheduler Wake Request does not execute tasks, change Dependency Readiness, create Proof, or bypass scheduler locking.
- Trigger wake only when a `dependencyCascade.updatedTasks` entry has final status `queued`.
- Trigger wake only when a `parentAggregation.updatedTasks` entry has final status `queued`.
- Do not trigger wake for blocked, waiting, error-only, or unchanged update batches.
- API routes should call an injected `requestSchedulerWake(reason)` callback; they must not import or call `runSchedulerOnce`.
- Use structured wake reasons:
  - `dependency_cascade_queued`
  - `parent_aggregation_queued`
- If one API request has queued updates from multiple sources, request wake once per source. The scheduler loop can coalesce execution.
- The CLI scheduler loop coalesces multiple wake requests into at most one pending tick.
- If a wake arrives while a scheduler tick is running, run one extra tick immediately after the current tick finishes.
- If a wake arrives while idle, schedule a near-immediate tick.
- After `scheduler.stop()`, wake requests are ignored.
- Do not expose wake requests in API responses.
- Do not publish a dashboard SSE event for wake requests.
- Keep the existing scheduler `maxTasks: 1` behavior. Wake changes timing, not throughput.

## Initial Scope

- [x] Add a `SchedulerWakeReason` union and optional `requestSchedulerWake` callback to the API server options.
- [x] Request `dependency_cascade_queued` after CEO approve cascade queues at least one downstream task.
- [x] Request `parent_aggregation_queued` after refresh/recover parent aggregation queues at least one parent task.
- [x] Wire CLI `startSchedulerLoop` to expose `requestWake(reason)`.
- [x] Pass the scheduler wake function into `createApiServer` from `startAutoCrop`.
- [x] Coalesce pending wake ticks and preserve the existing `running` guard.
- [x] Document that replan confirmation and ordinary task recovery requeue are out of scope for this pass.

## Non-Goals

- No scheduler wake from replan confirmation in this version.
- No scheduler wake from ordinary Task Recovery Request requeue or follow-up task creation in this version.
- No direct scheduler invocation from API routes.
- No new dashboard UI, API response field, or SSE event for wake requests.
- No change to `maxTasks`, scheduler lock behavior, approval policy, or dependency readiness rules.

## Verification

- [x] CLI test: a queued task starts after a wake request without waiting for the normal interval.
- [x] API integration: CEO approval with queued `dependencyCascade.updatedTasks` requests `dependency_cascade_queued`.
- [x] API integration: Proof Recovery on a department subtask with queued `parentAggregation.updatedTasks` requests `parent_aggregation_queued`.
- [x] API integration: dependency cascade updates that remain blocked or waiting do not request wake.
- [x] Server and CLI typechecks pass.
