# Proof Recovery Plan

## Goal

Fix `NO_PROOF` failures where an agent produced useful diff or patch output in a controlled task workspace, but the runtime did not register that output as reviewable Proof.

The immediate failure mode is a `repo-diff` task such as `Record implementation changes` failing with `NO_PROOF` even though the task workspace contains `.auto-crop-proof/*.diff` or a top-level `*.patch` file. The fix should preserve the Proof gate: useful Agent Output can become Proof only when it matches the task's proof schema and a controlled recovery rule records it.

## Decisions

- Add Proof Recovery as a small runtime capability.
- Keep Proof as the completion gate.
- Do not treat arbitrary Agent Output as Proof.
- Support both existing `diffText` capture and controlled workspace file recovery for `repo-diff`.
- Prefer `diffText` when it is available.
- If `diffText` is missing, scan only controlled paths:
  - `.auto-crop-proof/*.diff`
  - top-level workspace `*.diff`
  - top-level workspace `*.patch`
- Do not recursively scan the whole workspace.
- Ignore empty diff or patch files.
- If multiple diff or patch files are found, merge them into one `.auto-crop-proof/<taskId>.diff` Proof and record one primary Proof entry.
- Reuse `POST /api/tasks/:id/refresh` as the user-facing recovery trigger.
- On refresh, try Proof Recovery before the existing dependency refresh behavior.
- If Proof Recovery succeeds, move the task to `review` so CEO Office can approve or return it.
- If Proof Recovery succeeds for a `department_subtask`, move the subtask to `review` with Proof, trigger Parent Task Aggregation, and keep the subtask out of CEO Pending.
- If Proof Recovery fails, keep the current task state and return a clear explanation.
- Only allow refresh-triggered Proof Recovery for proof-missing states such as `failed/no_proof` or dependency states caused by missing deliverables.
- Show the recovery entry point beside the failed task in the department page, not in CEO Pending.
- Successful recovery should write both a task event and a department progress event.
- Use plain copy such as `已找到可审查证明，提交 CEO 审查`.

## User-Facing Flow

When a department task fails with `NO_PROOF`, the department page already shows the failed task and a refresh action.

After this change:

```text
Record implementation changes / FAILED · NO_PROOF
刷新
```

Clicking `刷新` should ask the backend to refresh the task. The backend should first try Proof Recovery.

If recovery finds a valid diff or patch:

```text
已找到可审查证明，提交 CEO 审查
```

For ordinary parent tasks, the task moves to `review`, and the CEO Workspace shows it in `CEO 待处理`.

For department subtasks, the subtask moves to `review` with recorded Proof, then Parent Task Aggregation updates the parent task. The subtask itself does not appear in `CEO 待处理`; CEO Office reviews the parent-level Proof after the parent summarization task runs.

If recovery cannot find a valid proof:

```text
没有找到可登记的 diff/patch proof
```

The task remains failed with `NO_PROOF`.

CEO Workspace should not own this action. CEO Office reviews submitted Proof; the department owns turning its own output into reviewable Proof.

## Runtime Scope

### Proof Collector

Extend the proof runtime so `repo-diff` proof can be recovered from controlled workspace files.

Implementation shape:

- Keep the existing `diffText` branch in `captureProofs`.
- Add a helper that discovers controlled diff candidates only when the schema accepts `diff`.
- Candidate paths:
  - `.auto-crop-proof/*.diff`
  - workspace-root `*.diff`
  - workspace-root `*.patch`
- Candidate files must be regular, non-empty text files.
- Merge candidate contents into `.auto-crop-proof/<taskId>.diff`.
- Include source filenames in the Proof summary, for example:

```text
Diff proof recovered from prototype-audit-trail.patch.
```

If a canonical `.auto-crop-proof/<taskId>.diff` already exists and is non-empty, it can be reused as the canonical Proof URI.

### Task Refresh

Update `POST /api/tasks/:id/refresh`.

Order:

1. Load the task.
2. If the task is eligible for Proof Recovery, attempt recovery first.
3. If recovery succeeds:
   - append Proof records
   - update task status to `review`
   - clear `latestFailureReason` and `latestFailureMessage`
   - write a task event
   - write a task progress event
   - for department subtasks, trigger Parent Task Aggregation when recorded Proof is present
   - return the updated task, event, progress event, recovered Proof, and any `parentAggregation` update
4. If recovery does not apply or fails to find Proof, continue the existing dependency refresh behavior.

Eligibility:

- task has a workspace path
- task proof schema supports the recovery being attempted
- task status/failure indicates missing proof, such as:
  - `failed` with `latestFailureReason === "no_proof"`
  - dependency states caused by missing deliverable

Do not use Proof Recovery to overwrite unrelated execution failures such as timeout, adapter failure, or policy blocks.

## API Response

The existing refresh response may be extended with optional recovery fields:

```ts
{
  task: TaskSummary;
  event?: TaskEventSummary;
  progressEvent?: TaskProgressEventSummary;
  proof?: ProofSummary[];
  recovery?: {
    status: "recovered" | "not_found" | "not_applicable";
    message: string;
  };
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

The dashboard can use `recovery.message` for immediate feedback, while the persisted progress event keeps the department flow visible after reload. When `parentAggregation` is present, the dashboard should upsert parent task updates and append parent aggregation events/progress.

## Dashboard Scope

- Keep the refresh action beside the failed department task.
- Do not add a CEO-side recovery action.
- If refresh returns `recovery.status === "recovered"`, update local task/proof/progress state and show the success message.
- If refresh returns `not_found`, show the clear no-proof message.
- Reuse existing retro components.
- Do not add a new Proof Recovery panel or new visual system.

## Data Model

No new table is required.

Recovered Proof uses the existing `proofs` table. Recovery history is represented by task events and task progress events.

## ADR

Add `docs/adr/0008-proof-recovery-from-controlled-workspace-output.md` to record why controlled workspace file recovery is allowed and why broad scanning or automatic history mutation is not allowed.

## Verification

Server tests:

- `captureProofs` still captures `diffText` for `repo-diff`.
- `captureProofs` recovers a non-empty `.auto-crop-proof/*.diff`.
- `captureProofs` recovers a non-empty top-level `*.patch`.
- `captureProofs` ignores empty diff and patch files.
- Multiple candidate files merge into one canonical diff Proof.
- Refresh turns `failed/no_proof` with recoverable diff output into `review`.
- Refresh does not recover unrelated failures.
- Refresh falls back to existing dependency refresh when recovery does not apply.

Dashboard tests:

- A failed `NO_PROOF` parent task can be refreshed into a CEO-reviewable task.
- A failed `NO_PROOF` department subtask can be refreshed into `review` with Proof and can aggregate its parent without appearing in CEO Pending.
- Recovery success displays `已找到可审查证明，提交 CEO 审查`.
- Recovery failure displays `没有找到可登记的 diff/patch proof`.
- CEO Pending receives ordinary parent tasks after recovery moves them to `review`; department subtasks remain excluded.

Regression:

```bash
pnpm --filter @auto-crop/server test
pnpm --filter @auto-crop/dashboard test -- src/App.test.tsx --runInBand
pnpm typecheck
pnpm lint
```

## Out Of Scope

- Automatically changing old failed tasks on server startup.
- Broad recursive scanning of task workspaces.
- Treating arbitrary files as Proof.
- Approving recovered Proof automatically.
- Adding new CEO-side Proof Recovery controls.
- Replacing the existing Proof gate.
