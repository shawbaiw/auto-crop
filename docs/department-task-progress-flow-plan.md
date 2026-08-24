# Department Task Progress Flow Plan

## Goal

Make department work feel like visible progress instead of a flat task list. When CEO Office assigns work to a department, the department should first assess the task, split it when needed, execute the resulting department work, and report one parent-task proof back to the review flow.

The UI should show the flow and state changes, not internal assessment details.

## Decisions

- CEO Office turns founder vision into objectives, departments, and parent tasks assigned to departments.
- Department agents do not blindly execute assigned parent tasks. Every department task enters assessment first.
- Department assessment checks size, ownership boundary, dependencies, risk, and whether the required proof is clear.
- If a task is large but still inside the department boundary, the department agent splits it into department subtasks.
- If a task crosses department boundaries, changes company priorities, lacks acceptance criteria, or needs user/CEO judgment, the department sends a reassignment request to CEO Office.
- Department subtasks may produce lightweight proof, but subtask proof is not shown by default.
- The parent task is complete only when required subtasks are done and a parent-task proof has been summarized.
- CEO Office sees cross-department progress at a summary level. Department pages show the department's own task progress flow.
- Department input follows the same assessment path whether the source is CEO Office or direct user input.

## User-Facing Flow

Department pages should show one progress flow per parent task. The default display should use a vertical progress treatment with short labels:

```text
✓ Received CEO task
✓ Assessment complete
✓ Split complete / No split needed
● Task 2 (Validate prototype) in progress
○ Summarize proof
○ Awaiting review
```

The flow is visible to the user, but the assessment details are hidden by default. Users should see that work is moving, which step is current, and where a task is blocked.

## Flow States

Use a small vocabulary for the user-facing flow:

- `received`: the department has received the parent task.
- `assessing`: the department is deciding size, ownership, dependencies, risk, and proof clarity.
- `assessment_complete`: the department can proceed or has produced a split/reassignment result.
- `splitting`: the department is creating department subtasks.
- `split_complete`: department subtasks are ready.
- `no_split_needed`: the parent task is small enough to execute directly.
- `executing`: a department subtask or direct parent task is running.
- `summarizing_proof`: the department is producing the parent-task proof.
- `awaiting_review`: the parent-task proof is ready for review.
- `complete`: the parent task has passed the review path.
- `blocked`: execution is blocked by a failed subtask, dependency, unclear proof, or required decision.
- `needs_ceo_reassignment`: the department cannot own the work without CEO Office rerouting.

## Parent And Subtask Rules

- Parent tasks are the tasks CEO Office assigns to departments.
- Department subtasks are implementation steps created by a department from one parent task.
- Limit automatic decomposition to two levels: CEO parent task to department subtask to execution step.
- If deeper decomposition seems necessary, send the work back to CEO Office for replanning.
- Parent task progress should identify the current subtask by name when helpful, for example `Task 2 (Validate prototype) in progress`.
- Subtask proof exists for audit/debugging but is not part of the default department UI.

## UI Notes

Defer exact visual design, but keep these constraints for the implementation pass:

- Use a vertical flow, not a dense status table.
- Show completed, current, waiting, and blocked steps distinctly.
- Show status changes inside the department that owns the task.
- Keep node labels short.
- Allow details to expand, but keep the default view compact.
- Show multiple parent-task flows ordered by priority or latest activity.
- CEO Office should show department-level summaries only.

## Implementation Order

1. Add domain types for parent tasks, department subtasks, flow steps, and reassignment requests.
2. Add a department assessment runtime step before task execution.
3. Add splitting logic for large in-boundary tasks.
4. Add CEO reassignment handling for cross-boundary or unclear tasks.
5. Persist parent/subtask relationships and flow events.
6. Update the scheduler to run subtasks and roll their results into parent-task proof.
7. Update the department workspace UI to render vertical progress flows.
8. Update CEO Office to render cross-department flow summaries.
9. Add tests for assessment, splitting, reassignment, parent proof completion, and UI flow rendering.

## This Version Does Not Do

- No default display of subtask proof.
- No deep recursive task tree beyond two levels.
- No user approval for ordinary department-local splits.
- No replacement of the Proof gate.
- No detailed assessment transcript in the main department UI.
- No table-heavy task management interface.

## Verification

- Server tests cover department assessment before execution.
- Server tests cover large in-boundary tasks being split into department subtasks.
- Server tests cover cross-boundary tasks producing CEO reassignment requests.
- Server tests cover parent tasks completing only after required subtasks and parent proof are complete.
- Dashboard tests cover vertical progress flows for received, assessing, executing, blocked, awaiting review, and complete states.
- Dashboard tests confirm subtask proof is not shown by default.

Run:

```bash
pnpm --filter @auto-crop/server test
pnpm --filter @auto-crop/server typecheck
pnpm --filter @auto-crop/dashboard test
pnpm --filter @auto-crop/dashboard typecheck
```
