# Project Context

## Glossary

- **Auto-Crop**: Local-first runtime that coordinates installed AI coding agents as a small operating company.
- **CEO Agent**: The user-selected local agent, such as Claude Code or Codex, that converts founder input into a company blueprint.
- **Founder Vision**: The user's natural-language description of what the company should build or pursue.
- **Permission Mode**: Runtime policy level for local execution. Current values are `safe`, `balanced`, and `autonomous`.
- **Company Blueprint**: The structured result returned by the CEO Agent, including company metadata, departments, objectives, key results, proof schemas, and first tasks.
- **Onboarding Wizard**: The sequential setup flow shown before a company is created. It collects company name, CEO Agent, Founder Vision, and Permission Mode one step at a time.
- **Creation Loading Page**: The CRT-styled intermediate page shown after `Create Company` while the backend waits for the CEO Agent to produce a blueprint.
- **Department Workspace**: The post-creation default view that shows a left rail of `CEO` plus generated departments, and a right-side role workspace for the selected role.
- **Reusable Retro UI**: Existing dashboard primitives under `apps/dashboard/src/ui/`, including `AppShell`, `PageHeader`, `Workspace`, `RetroPanel`, `RetroButton`, `RetroField`, `RetroTextarea`, `RetroSelect`, `RetroListRow`, `RetroBadge`, `RetroStatus`, `VideotexLog`, and `VideotexKeyValue`.

## UI Implementation Rule

New dashboard flows must reuse existing reusable retro components wherever possible. Create new UI primitives only when the existing component set has a clear gap, and prefer small composition components over new styling systems.
