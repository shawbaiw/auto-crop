# Department Task Assessment And Progress Flow

Auto-Crop will route CEO-assigned department tasks through a department assessment step before execution. Departments may split large in-boundary work into department subtasks, while cross-boundary or unclear work returns to CEO Office as a reassignment request. The user-facing department page will show a compact vertical progress flow for each parent task instead of exposing a flat task-status table.

## Considered Options

- **Execute CEO-assigned tasks directly:** simplest scheduler model, but large tasks are likely to time out, produce weak proof, or hide why work is stuck.
- **Require CEO Office to split all tasks until executable:** keeps decomposition centralized, but makes CEO Office a bottleneck and prevents departments from applying local judgment.
- **Let departments split any task recursively:** flexible, but risks deep task trees, unclear ownership, and proof that is hard for users to audit.
- **Add department assessment with bounded local splitting:** keeps CEO Office responsible for cross-department planning while letting departments turn their own large tasks into executable work.

## Decision

Use department assessment with bounded local splitting.

Every department task has a parent task assigned by CEO Office. Before execution, the department assesses size, ownership boundary, dependencies, risk, and proof clarity. If the task is small enough, it executes directly. If the task is large but belongs to the department, the department splits it into subtasks. If the task crosses department boundaries, changes company priorities, lacks clear acceptance criteria, or requires user/CEO judgment, it becomes a CEO Office reassignment request.

The UI should make this flow visible without exposing unnecessary details. Department pages show progress states and state changes such as:

```text
Received CEO task
Assessment complete
Split complete
Task 2 (Validate prototype) in progress
Summarize proof
Awaiting review
```

Subtasks may have lightweight proof for audit and debugging, but subtask proof is not shown by default. The parent task proof is the primary user-facing proof and remains the artifact that enters review.

## Consequences

The data model will need parent/subtask relationships, department progress flow events, and a way to represent CEO reassignment requests. The scheduler will need an assessment phase before ordinary execution and must roll subtask outcomes into parent-task proof. The dashboard should move away from status counters for department work and toward compact vertical progress flows.

This keeps the system auditable while preserving the feeling that each department is actively advancing assigned work. It also prevents hidden recursive decomposition by limiting automatic task structure to CEO parent task, department subtask, and execution step.
