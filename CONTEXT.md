# Project Context

## Glossary

- **Auto-Crop**: Local-first runtime that coordinates installed AI coding agents as a small operating company.
- **CEO Agent**: The user-selected local agent, such as Claude Code or Codex, that converts founder input into a company blueprint.
- **Founder Vision**: The user's natural-language description of what the company should build or pursue.
- **CEO Intake**: A post-creation natural-language input submitted by the user to CEO Office. A CEO Intake can describe a new vision, task, material, constraint, or direction. It is appended to company context for CEO evaluation and planning; it does not overwrite the original Founder Vision.
- **Permission Mode**: Runtime policy level for local execution. Current values are `safe`, `balanced`, and `autonomous`.
- **Company Blueprint**: The structured result returned by the CEO Agent, including company metadata, departments, objectives, key results, proof schemas, and first tasks.
- **Agent Output**: The raw stdout/stderr content and workspace side effects produced by an agent run. Agent Output can be useful evidence for humans, but it is not itself a completed task deliverable unless the runtime captures it as Proof.
- **One-shot Agent Run**: An Agent Run executed by starting a fresh agent process for one task attempt, then ending that process when the attempt finishes. _Avoid_: stateless task, cold run.
- **Agent Session**: A reusable agent context container that may serve multiple Agent Runs for the same company, agent, and Permission Mode. An Agent Session can improve continuity, but it does not decide whether a task is complete.
- **Session Memory**: Context remembered inside an Agent Session. Session Memory is not Proof, Consumable Proof, a Task Deliverable, or a Handoff Package. _Avoid_: hidden proof, implicit handoff.
- **Session Policy**: Runtime rules that decide whether an Agent Run is eligible to attempt an Agent Session. Session Policy is separate from Proof Schema, which defines the required deliverable.
- **Task Deliverable**: The artifact a task must produce to be eligible for review. A Task Deliverable must be represented by Proof that matches the task's proof schema.
- **Proof**: A runtime-recorded artifact, command output, URL, screenshot, diff, deployment, or other accepted evidence that satisfies a task's proof schema. Tasks without Proof are not complete, even when the agent produced useful Agent Output.
- **CEO Review Request**: A department-submitted request for CEO Office to approve or return work after execution. Departments can submit and track CEO Review Requests, but CEO Office owns the approve/return decision. A checkpoint CEO Review Request returns the task to execution when approved; a completion CEO Review Request completes the task when approved.
- **Partial Output**: Useful Agent Output left behind by a failed or timed-out task. Partial Output should remain visible for diagnosis and follow-up, but it does not make the task complete.
- **Task Execution Profile**: A task execution contract that sets the expected time budget and failure explanation style for a task based on its deliverable shape. It is part of how Auto-Crop decides how long an agent should be allowed to work before the run is considered failed.
- **Effective Timeout**: The final timeout budget actually enforced for an Agent Run after Task Execution Profile and environment override rules are resolved. _Avoid_: displayed budget, requested timeout.
- **Task Execution Summary**: The latest durable outcome facts shown on a task, including failure reason, failure message, execution profile, and Effective Timeout. _Avoid_: activity text, run log.
- **Task Dependency**: A relationship where one task can only run after another task has produced review-ready Proof. _Avoid_: task order, follow-up note.
- **CEO Reassignment Request**: A department-submitted request asking CEO Office to clarify, split, replan, or reassign a task before or during execution. It is not a CEO Review Request because no Task Deliverable is being approved.
- **Consumable Proof**: Proof that is recorded by the runtime and can be handed to downstream tasks as input. _Avoid_: promising stdout, informal result.
- **Dependency Readiness**: The scheduler decision that all upstream Task Dependencies have Consumable Proof and the downstream task may start. _Avoid_: dependency status check.
- **Bounded Recovery**: Automatic task recovery that changes execution conditions and has a hard stop, such as escalating an Effective Timeout before requiring replanning. _Avoid_: infinite retry.
- **Replan Required**: A task outcome where the current task is too broad or expensive for the available execution profile and should be split or rewritten before downstream work continues. _Avoid_: timeout failure.
- **Agent Activity**: Durable, user-facing timeline entries that explain task execution progress and outcomes. _Avoid_: debug log, raw stdout.
- **Emergency Stop**: The user-facing command that stops active Agent Runs and active Agent Sessions for a company without deleting queued tasks. _Avoid_: normal pause, task cancellation.
- **Artifact Workspace**: The workspace whose files are treated as the task's runnable or inspectable product. A dependent validation task may use another task's Artifact Workspace when validating that task's output. _Avoid_: task folder, temp folder.
- **Dependency Block**: A task state caused by an unmet or failed Task Dependency, distinct from an agent execution failure. _Avoid_: failed validation, skipped task.
- **Company State Snapshot**: The persisted company, department, objective, task, proof, and review state needed to rebuild the dashboard after a refresh. _Avoid_: blueprint cache, frontend state.
- **Onboarding Wizard**: The sequential setup flow shown before a company is created. It collects company name, CEO Agent, Founder Vision, and Permission Mode one step at a time.
- **Creation Loading Page**: The CRT-styled intermediate page shown after `Create Company` while the backend waits for the CEO Agent to produce a blueprint.
- **Department Workspace**: The post-creation default view that shows a left rail of `CEO` plus generated departments, and a right-side role workspace for the selected role.
- **Reusable Retro UI**: Existing dashboard primitives under `apps/dashboard/src/ui/`, including `AppShell`, `PageHeader`, `Workspace`, `RetroPanel`, `RetroButton`, `RetroField`, `RetroTextarea`, `RetroSelect`, `RetroListRow`, `RetroBadge`, `RetroStatus`, `VideotexLog`, and `VideotexKeyValue`.

## UI Implementation Rule

New dashboard flows must reuse existing reusable retro components wherever possible. Create new UI primitives only when the existing component set has a clear gap, and prefer small composition components over new styling systems.
