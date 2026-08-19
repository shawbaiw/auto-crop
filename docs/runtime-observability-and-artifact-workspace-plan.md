# Runtime Observability And Artifact Workspace Plan

## Goal

Make task failures explainable after refresh and make validation tasks operate on the artifact they are supposed to validate. This follows the current Task Execution Profile work but closes the gaps found in testing: the UI showed a long budget while the CLI process was killed at 120 seconds, and validation tasks ran in empty workspaces after prototype tasks failed or timed out.

## Findings

- Task ordering now works through explicit task `position`.
- `Build playable prototype` failed because the effective CLI timeout was still 120 seconds.
- The current `AUTO_CROP_AGENT_TIMEOUT_MS` rule can silently lower a long task from 10 minutes to 2 minutes.
- `Validate prototype locally` ran in its own empty workspace, so it could not validate the prototype task's partial or completed output.
- Failure reason exists in scheduler events, but the database does not persist enough execution detail for dashboard refresh or later diagnosis.

## Decisions

- Store execution outcome fields durably, not only in SSE events.
- Store full execution facts on `agent_runs`: execution profile name, requested timeout, effective timeout, failure reason, and failure message.
- Store latest task outcome summary on `tasks` for fast dashboard rendering after refresh.
- Store Agent Activity durably so refresh does not erase the execution timeline.
- Add a Company State Snapshot endpoint so the dashboard can rebuild persisted company/task state after refresh.
- Persist the current company id in browser storage after create/activate, then hydrate from the Company State Snapshot on app load.
- Include Proof summaries in the Company State Snapshot so Proof views can recover after refresh.
- Keep Task Execution Profile as the default budget source.
- Resolve timeout in scheduler/runtime only. Adapters should enforce the already-resolved Effective Timeout and should not read timeout environment variables.
- Let `AUTO_CROP_AGENT_TIMEOUT_MS` raise a budget only; it must not silently lower a task profile budget.
- Add a separate `AUTO_CROP_FORCE_AGENT_TIMEOUT_MS` escape hatch for deliberate full override test runs.
- Do not run dependency consumers when their producer has not reached `review`.
- Mark blocked dependency consumers as `blocked` with a dependency-specific reason.
- Let validation tasks use the upstream build task's Artifact Workspace in the first version.
- Infer the common build -> validate dependency during company creation and persist it as a first-class dependency relationship.
- Show dependencies from persisted dependency relationships; the UI must not infer dependency relationships on its own.
- Keep waiting dependency consumers in `queued` while the producer is `queued` or `running`, with a dependency note for display.
- Waiting dependency consumers must not block unrelated queued work. The scheduler should scan past them and dispatch other eligible tasks in the same tick.
- Block only direct dependency consumers when a dependency fails. Do not cascade blocks through unrelated later tasks.
- Persist direct dependency failure as `dependency_failed`. Do not treat `dependency_not_ready` as a failure; it is only the queued waiting note.
- When a producer task fails, immediately block its direct dependency consumers and keep scheduler dependency checks as a fallback.
- Do not let validation tasks run automatically against Partial Output. A human-readable Partial Output path can be shown, but it does not enter the dependency chain.
- Set build/prototype task `artifact_workspace_path` at task creation time so partial output has a stable location to show.
- Validation tasks keep their own task workspace for logs, prompts, temporary files, and side output, even when the agent command runs in the producer's Artifact Workspace.
- Validate Proof belongs to the Validate task. Use the Validate workspace and validation log as the primary proof source; allow references to the producer Artifact Workspace only as read-only evidence.
- Show build/prototype Artifact Workspace paths as Partial Output when useful, including on failed tasks, while clearly treating them as non-Proof.
- Guide prototype tasks toward lightweight browser artifacts, preferably static `index.html` or a small Vite app, instead of heavy scaffolds unless deployment is explicitly required.
- Add lightweight proof schema sanity checks so copy/report/plan tasks do not accidentally require `landing-page-file` proof and prototype/build tasks do not accidentally use text-only proof schemas.
- For proof schema sanity checks, auto-correct only deterministic built-in playbook mismatches. For ambiguous CEO-generated mismatches, record a warning/activity message and keep the generated schema.
- Keep Proof as the completion gate. Partial Output can be visible and useful without making a task complete.
- Do not infer or backfill dependencies for historical tasks during migration. Dependency inference applies only when new tasks are created.
- Do not automatically unlock or retry a dependency-blocked task in this version. Future task refresh or manual retry work should recompute dependency state.
- If there is no stored current company id in the browser, return to onboarding instead of guessing the latest company.
- Agent Activity is a concise lifecycle timeline, not a raw stdout viewer. Full stdout/stderr stay in log files.
- Persist only user-visible task lifecycle activity, not every raw log line.
- Invalid timeout environment variables are ignored and recorded as visible warning activity.

## Data Model

Extend `agent_runs`:

- `execution_profile_name`
- `requested_timeout_ms`
- `effective_timeout_ms`
- `failure_reason`
- `failure_message`

Extend `tasks`:

- `latest_failure_reason`
- `latest_failure_message`
- `latest_execution_profile_name`
- `latest_requested_timeout_ms`
- `latest_effective_timeout_ms`
- `artifact_workspace_path`
- `dependency_note`

Add `task_dependencies`:

- `task_id`
- `depends_on_task_id`
- unique `(task_id, depends_on_task_id)`

Repositories should expose dependencies to callers as `dependsOnTaskIds`, but reverse dependency lookup should use the table.

Add `task_events`:

- `id`
- `company_id`
- `task_id`
- `type`
- `message`
- `created_at`
- optional structured fields for status, failure reason/message, execution profile, requested timeout, effective timeout, dependency note, and artifact workspace path

Add `GET /api/companies/:companyId/state`:

- `company`
- `departments`
- `objectives`
- `tasks`
- `reviews`
- `proof`
- `activity`

Use migrations that backfill nullable fields safely for existing SQLite databases.

## Timeout Rules

Resolution order:

1. Resolve the task's Task Execution Profile.
2. Use the profile timeout as the requested timeout.
3. If `AUTO_CROP_AGENT_TIMEOUT_MS` is set and is higher than the requested timeout, use it as the effective timeout.
4. If `AUTO_CROP_AGENT_TIMEOUT_MS` is set and is lower than the requested timeout, ignore it and log a visible warning in Agent Activity.
5. If `AUTO_CROP_FORCE_AGENT_TIMEOUT_MS` is set, use it as the effective timeout and record that fact in the failure message/log context.
6. If either timeout environment variable is not a positive integer, ignore it and log a visible warning in Agent Activity.

The dashboard should display the effective timeout when showing a started or failed run. If requested and effective differ, show both in compact form.

Adapters receive only the resolved Effective Timeout. They must not apply their own environment timeout override.

## Failure Reason Values

Use a small shared enum for persisted failure reasons:

- `timeout`: the agent process exceeded the effective timeout.
- `agent_failed`: the agent process returned a non-zero exit or adapter-level failure.
- `no_proof`: the agent finished but the Proof collector could not find required proof.
- `proof_capture_failed`: proof collection itself errored.
- `dependency_failed`: a direct dependency failed, was blocked, or was cancelled before this task ran.

Do not persist `dependency_not_ready` as a failure reason. A not-ready dependency keeps the task `queued` and writes a waiting dependency note.

## Event Shape

Task-changing events should be persisted to `task_events` and sent over SSE. Messages remain human-readable for Agent Activity, but events should also carry structured fields when available:

- `status`
- `failureReason`
- `failureMessage`
- `executionProfileName`
- `requestedTimeoutMs`
- `effectiveTimeoutMs`
- `dependencyNote`
- `artifactWorkspacePath`

The dashboard should update task rows from structured fields rather than parsing `message`.

Persisted Agent Activity includes only lifecycle/debuggable user-facing events:

- `task_started`
- `task_review`
- `task_failed`
- `task_blocked`
- `task_warning`
- `partial_output`

Do not persist or display full raw stdout/stderr in Agent Activity. Store raw stdout/stderr in the task log file and surface the log path through concise activity when useful.

## Dependency Rules

First-version inference:

- A task with proof schema `test-output`, `local-url`, or `screenshot` depends on the nearest earlier task in the same company with proof schema `landing-page-file` or `repo-diff`.
- The dependency is inferred after tasks are created for a company, then persisted in `task_dependencies`.
- The migration must not backfill inferred dependencies for existing tasks.
- The dashboard determines displayed dependency by reading `dependsOnTaskIds` from the API, resolving those task IDs against the current task list, and showing the upstream task title/status.
- Future explicit `depends_on_task_ids` from the blueprint should override inference once supported.

Scheduling:

- If a dependency is `queued` or `running`, leave the dependent task `queued` and record/display a waiting dependency note.
- A queued task waiting on a dependency is skipped for the current scheduler tick; it must not stop the scheduler from checking later queued tasks.
- If a direct dependency is `failed`, `blocked`, or `cancelled`, mark the dependent task `blocked`.
- When marking a dependent task `blocked`, store `latest_failure_reason = dependency_failed` and a message naming the direct dependency.
- When a task fails, immediately find direct dependency consumers and apply the same `dependency_failed` block. Scheduler checks still enforce this if the immediate block path is missed.
- If all dependencies are `review` or `complete`, the dependent task can run.
- Do not infer transitive blocking for tasks that do not directly depend on the failed task.
- Once a task is blocked by dependency failure, this version does not automatically unlock it. A future task refresh or manual retry flow should recalculate the dependency state.

Workspace:

- Build tasks keep their own task workspace as their Artifact Workspace from creation time.
- Validation tasks run the agent command from the producer's Artifact Workspace.
- Validation tasks still keep their own workspace for prompts, logs, temporary files, and side output.
- Validation logs still belong to the validation task.
- Validation Proof belongs to the validation task even when its command ran in the producer workspace.
- Proof collection for validation should use the validation task workspace and validation log as the primary source. References to producer files are evidence about the tested artifact, not a transfer of task ownership.
- Partial Output remains visible but is not automatically accepted as an Artifact Workspace for validation.
- Build/prototype Artifact Workspace paths can be shown as Partial Output even when the task failed. The UI must label them as non-Proof and must not use them to unlock dependents.

## Prototype Task Guidance

Prototype/build tasks should receive a prompt suffix that favors fast, inspectable browser output:

- Prefer static `index.html`, `src/main.tsx`, `src/App.tsx`, or `app/page.tsx`.
- Prefer built-in browser APIs and small local code over installing large scaffold dependencies.
- Do not initialize Sites/Vinext/Next unless the task explicitly asks for deployment or an existing `.openai/hosting.json` requires it.
- Leave a clear entry file that the Proof collector can recognize.

## Proof Schema Sanity Checks

When creating tasks, run a lightweight mismatch check:

- Titles/descriptions containing `copy`, `plan`, `brief`, `research`, or `assets` should normally use `product-brief` or `research-report`.
- Titles/descriptions containing `build`, `prototype`, `playable`, or `landing page` should normally use `landing-page-file`.
- Titles/descriptions containing `validate`, `test`, `check`, `screenshot`, or `local URL` should normally use `test-output`, `screenshot`, or `local-url`.

First version should auto-correct obvious built-in playbook mismatches and log a warning/activity message for CEO-generated mismatches that are not safe to correct.

## UI

Reuse existing retro UI components.

Show on task rows:

- status
- latest failure reason
- effective timeout for timeout failures
- dependency blocked reason when applicable
- waiting dependency note when the task is still queued behind a dependency

Show in Agent Activity:

- task started with profile and effective timeout
- task failed with persisted failure reason/message
- task blocked because dependency was not review-ready
- task warning for ignored timeout env or ambiguous proof schema mismatch
- Partial Output path when a failed run left files behind
- log path for full stdout/stderr when useful

Dependency display is determined from backend state: API `dependsOnTaskIds` identifies the upstream task, and the current upstream task status determines whether the note reads like `waiting for Build playable prototype` or `blocked by failed dependency: Build playable prototype`.

On refresh:

- Read the stored company id from browser storage.
- Fetch the Company State Snapshot.
- Rebuild the current dashboard state from backend data, not from the old create-company response.
- Restore Proof summaries from persisted `proof` entries in the snapshot.
- Restore Agent Activity from persisted `activity` entries in the snapshot.
- If the snapshot is missing or deleted, clear the stored company id and show onboarding.
- If no company id is stored, show onboarding rather than guessing the latest company.

## Implementation Order

1. Add core types for execution outcome fields and task dependencies.
2. Add SQLite migrations for `agent_runs`, `tasks`, `task_dependencies`, and `task_events`.
3. Update repositories to persist and read execution outcome fields.
4. Add repository methods for forward and reverse dependency lookup.
5. Add repository methods for durable Agent Activity.
6. Change timeout resolution so normal env override cannot reduce a profile budget, and keep that resolution outside adapters.
7. Record effective timeout in agent result/log context, task summary, persisted activity, and scheduler events.
8. Add dependency inference for validation tasks during company creation or immediately after task creation.
9. Add proof schema sanity checks for generated tasks.
10. Update prototype/build prompts to prefer lightweight browser artifacts.
11. Update scheduler dependency gating before task dispatch, including scanning past queued tasks that are only waiting on dependencies.
12. Fetch a wider queued candidate window such as `max(maxTasks * 5, 20)`, while dispatching at most `maxTasks` eligible tasks.
13. Immediately block direct dependency consumers when a producer fails.
14. Resolve Agent Run workspace from dependency Artifact Workspace when a validation task runs.
15. Update proof collection to keep validation Proof attached to the validation task.
16. Add the Company State Snapshot endpoint and dashboard hydrate path.
17. Update dashboard task rows and activity log using existing components and structured SSE fields.
18. Update docs that mention the old 120-second override command.
19. Add focused tests for timeout resolution, invalid timeout env warnings, persistence, dependency blocking, validation workspace selection, lightweight prototype prompts, schema sanity checks, hydrate, proof snapshot, structured SSE, and persisted activity.

## This Version Does Not Do

- No persistent agent sessions.
- No automatic retry or continuation from Partial Output.
- No automatic unlock/retry for dependency-blocked tasks after an upstream task is later fixed.
- No full artifact packaging/copying layer.
- No CEO-authored explicit dependency schema.
- No new dashboard component system.
- No automatic cleanup of large generated `node_modules` workspaces.
- No human action to accept Partial Output as the Artifact Workspace.
- No automatic latest-company selection when browser storage has no current company id.

## Suggested Next Steps After This

- Add explicit dependency fields to CEO blueprint output.
- Add a follow-up task policy that can continue from Partial Output.
- Add task refresh/manual retry to recompute dependency state and unblock tasks after upstream recovery.
- Add a company picker or recent companies view for returning to earlier companies without browser storage.
- Add artifact packaging for handoff between non-validation tasks.
- Add workspace cleanup/retention policy for large prototype scaffolds.
- Revisit persistent agent sessions only after effective timeouts, durable failures, and artifact workspaces are stable.

## Verification

- Server tests cover environment timeout raising but not lowering a long profile.
- Server tests cover force timeout override.
- Server tests cover persisted `agent_runs` execution fields.
- Server tests cover task latest failure summary after scheduler failure.
- Server tests cover validation task blocked when build task fails.
- Server tests cover validation task using upstream Artifact Workspace when build task reaches review.
- Dashboard tests cover refreshed failed task reason and effective timeout display.
- Dashboard tests cover dependency blocked display.
- Dashboard tests cover refreshing into the Company State Snapshot.
- Dashboard tests cover Proof summaries after refresh.
- Dashboard tests cover persisted Agent Activity after refresh.
- Dashboard tests cover structured SSE fields updating task rows.
- Server tests cover queued dependency consumers being skipped while unrelated queued tasks still run.
- Server migration tests cover no inferred dependency backfill for historical tasks.
- Server tests cover immediate direct-consumer blocking when a producer fails.
- Server tests cover reverse dependency lookup through `task_dependencies`.
- Server tests cover invalid timeout environment variables being ignored with visible warning activity.

Run:

```bash
pnpm --filter @auto-crop/server test
pnpm --filter @auto-crop/server typecheck
pnpm --filter @auto-crop/dashboard test
pnpm --filter @auto-crop/dashboard typecheck
```
