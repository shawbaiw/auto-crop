# Agent-Generated Replan Proposals Implementation Plan

**Goal:** Upgrade semi-automatic replanning from deterministic templates to selected-CEO-Agent generated proposals, while keeping user confirmation before task graph mutation.

**Architecture:** Replanning now has a planner prompt/parser layer. `createReplanProposalForTask` can call the company's selected CEO Agent with source task, downstream consumers, and allowed proof schemas. If the Agent returns valid fenced JSON, the stored proposal uses that rationale and replacement task chain. If the Agent fails or returns invalid JSON, the runtime falls back to the deterministic split template.

## Completed Tasks

- [x] Add `replanPlanner` prompt builder for source task, downstream consumers, and allowed proof schemas.
- [x] Add strict fenced JSON parser for planner output.
- [x] Validate replacement task shape, risk level, capabilities, and playbook proof schema IDs.
- [x] Update replan runtime to optionally call a planner Agent before template fallback.
- [x] Write planner prompts into the company workspace for auditability.
- [x] Keep existing deterministic proposal behavior when planner context is absent or invalid.
- [x] Update API route to pass the company's selected CEO Agent and playbook into replan creation.
- [x] Add runtime and API tests for Agent-generated proposals and fallback behavior.

## Current Behavior

- User still confirms the proposal before replacement tasks are created.
- Original `needs_replan` task remains visible and is marked replaced only after confirmation.
- Downstream dependencies are still rewired only after confirmation.
- Planner-generated proposals must use proof schemas from the selected playbook.

## Future Work

- Show whether a proposal came from Planner output or deterministic fallback.
- Store planner prompt path and parse/fallback diagnostics on the proposal record.
- Let the user edit a proposed replacement task chain before confirming.
- Add explicit task dependency fields to the CEO blueprint so future replan prompts can reason over authored contracts rather than only persisted inferred dependencies.
