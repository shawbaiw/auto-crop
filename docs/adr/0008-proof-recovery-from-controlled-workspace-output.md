# Proof Recovery From Controlled Workspace Output

Auto-Crop will allow Proof Recovery from controlled task workspace files when an agent run finished without recorded Proof but left behind output that satisfies the task's proof schema.

## Context

Auto-Crop treats Proof as the completion gate. Agent Output can be useful, but a task is not complete unless the runtime records Proof matching the task's proof schema.

The current `repo-diff` path only records Proof when the proof collector receives `diffText`. Real agent runs may instead leave a `.diff` or `.patch` file in the task workspace, including `.auto-crop-proof/*.diff` or a top-level audit patch. In that case the task can fail with `NO_PROOF` even though the department produced a checkable diff.

This creates a bad user experience: the department appears stuck, downstream tasks remain blocked, and CEO Office cannot review the work. At the same time, the system must not weaken Proof by treating arbitrary workspace files as completion.

## Considered Options

- **Only accept `diffText`:** keeps the proof collector narrow, but fails real runs where agents produce patch files instead of returning structured diff text.
- **Scan the whole workspace recursively for diff or patch files:** maximizes recovery, but risks collecting unrelated files from dependencies, generated folders, examples, or hidden output.
- **Allow controlled file recovery for known diff locations:** recovers common real output while keeping the Proof gate narrow and auditable.
- **Automatically repair all historical failed tasks on startup:** improves old state without user action, but silently mutates task history and may surprise users.
- **Use a new recovery endpoint:** makes the operation explicit, but adds another UI/API concept when the existing task refresh action already means "check this task again."

## Decision

Auto-Crop will support controlled Proof Recovery.

For `repo-diff` tasks, the runtime may record recovered diff Proof from:

- `diffText`, when present
- `.auto-crop-proof/*.diff`
- top-level workspace `*.diff`
- top-level workspace `*.patch`

Recovery must ignore empty files and must not recursively scan the entire workspace. When multiple diff or patch files are found, the runtime should merge them into one canonical `.auto-crop-proof/<taskId>.diff` Proof and include source filenames in the summary.

The recovery trigger for checking existing output remains the task refresh path where it already exists. Task Recovery Requests use a separate `POST /api/tasks/:id/recover` endpoint, and should try controlled Proof Recovery before rerunning or creating follow-up work. If Proof Recovery succeeds, the task moves to `review`, recovered Proof is persisted, and the department flow records that checkable Proof was found and submitted to CEO Office.

Recovery is allowed only for proof-missing states such as `failed/no_proof` or dependency states caused by missing deliverables. It must not convert unrelated failures into review-ready tasks.

CEO Office will not own Proof Recovery. Departments own turning their output into reviewable Proof; CEO Office owns approval and return decisions after Proof is submitted. Task Recovery is also not Proof Recovery: it restarts progress after failure, timeout, or stale running state, while Proof Recovery only registers valid existing output as Proof.

## Consequences

Users can recover from a common `NO_PROOF` failure by clicking the existing department-side refresh action. When the workspace contains a valid diff or patch, the task becomes reviewable without forcing the agent to rerun.

The Proof gate stays intact. Recovery records normal Proof entries and routes work through CEO review instead of auto-completing tasks.

The implementation remains conservative. It does not scan arbitrary files, does not mutate old failed tasks on startup, and does not add a new recovery state machine. Future proof schemas may add similarly controlled recovery rules, but each rule should stay schema-specific and auditable.
