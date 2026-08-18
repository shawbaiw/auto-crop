# Project Context

## Glossary

- **Auto-Crop**: Local-first runtime that coordinates installed AI coding agents as a small operating company.
- **CEO Agent**: The user-selected local agent, such as Claude Code or Codex, that converts founder input into a company blueprint.
- **Founder Vision**: The user's natural-language description of what the company should build or pursue.
- **Permission Mode**: Runtime policy level for local execution. Current values are `safe`, `balanced`, and `autonomous`.
- **Company Blueprint**: The structured result returned by the CEO Agent, including company metadata, departments, objectives, key results, proof schemas, and first tasks.
- **Company Workspace**: The shared filesystem area for one company under `.auto-crop/companies/<companyId>/`. It stores department memory, task inputs, artifacts, proof, logs, and review outputs that later tasks can read.
- **Task Workspace**: The isolated execution directory for one task under `.auto-crop/workspaces/<taskId>/`. It receives the task packet and holds task-specific artifacts and proof output.
- **Task Dependency**: A prerequisite relationship between tasks. A dependent task is runnable only after its prerequisites have produced accepted proof.
- **Task Packet**: The scheduler-generated context bundle handed to an agent before one task starts. It includes the task brief, relevant company and department context, dependency proof summaries, artifact paths, proof contract, and permission constraints.
- **Proof Contract**: The machine-readable output requirement for a task. A task can move to review only when the agent produces proof that matches the task's proof schema.
- **Onboarding Wizard**: The sequential setup flow shown before a company is created. It collects company name, CEO Agent, Founder Vision, and Permission Mode one step at a time.
- **Creation Loading Page**: The CRT-styled intermediate page shown after `Create Company` while the backend waits for the CEO Agent to produce a blueprint.
- **Department Workspace**: The post-creation default view that shows a left rail of `CEO` plus generated departments, and a right-side role workspace for the selected role.
- **Reusable Retro UI**: Existing dashboard primitives under `apps/dashboard/src/ui/`, including `AppShell`, `PageHeader`, `Workspace`, `RetroPanel`, `RetroButton`, `RetroField`, `RetroTextarea`, `RetroSelect`, `RetroListRow`, `RetroBadge`, `RetroStatus`, `VideotexLog`, and `VideotexKeyValue`.

## UI Implementation Rule

New dashboard flows must reuse existing reusable retro components wherever possible. Create new UI primitives only when the existing component set has a clear gap, and prefer small composition components over new styling systems.
