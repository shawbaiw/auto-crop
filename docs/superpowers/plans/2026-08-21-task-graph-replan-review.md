# Task Graph Replan Review Implementation Plan

**Goal:** Finish task 3: UI review/approval for replacing a task graph. A user should understand a replan proposal before confirming it.

**Architecture:** Replan proposals store provenance and planner diagnostics. The API returns those fields through existing proposal summaries. The dashboard review panel computes the graph preview from current tasks and `dependsOnTaskIds`: original source task, proposed replacement chain, affected downstream consumers, and the dependency rewire target after confirmation.

## Tasks

- [x] Persist proposal provenance:
  - `proposalSource`: `planner_agent` or `deterministic_template`
  - `plannerAgentId`
  - `plannerPromptPath`
  - `plannerFailureReason`
  - `plannerFailureMessage`
- [x] Populate provenance in runtime:
  - planner success records Agent source and prompt path
  - planner failure records template fallback and diagnostic text
  - no planner context records template fallback
- [x] Return provenance from API summaries and client types.
- [x] Upgrade Company Operations review UI:
  - show proposal source and diagnostics
  - show original task
  - show replacement task chain
  - show affected downstream tasks
  - show dependency rewire preview before confirmation
- [x] Add server and dashboard tests.
- [x] Run full verification.

## Out Of Scope

- Editing replacement tasks before confirmation.
- A dedicated modal flow for proposal review.
- Storing a full graph diff snapshot separately from proposal fields.
