# Semi-Automatic Replan Proposals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn durable `needs_replan` tasks into reviewable replacement-task proposals, then let the user confirm creation and dependency rewiring.

**Architecture:** The runtime stores replan proposals as first-class records. A deterministic planner creates a safe split from a `needs_replan` task and its blocked downstream consumers; the dashboard presents the proposal; user confirmation creates replacement tasks, links them in sequence, rewires original downstream dependencies to the final replacement task, and marks the original task as replaced.

**Tech Stack:** TypeScript, Node.js SQLite runtime, Vitest, React dashboard, existing retro UI primitives.

---

## Product Decisions

- Replanning is **semi-automatic**. The runtime may propose a task split automatically, but it does not mutate the task graph until the user confirms.
- Original `needs_replan` tasks remain visible for diagnosis. They are marked as replaced through execution summary text, not deleted.
- Replacement tasks inherit company, department, key result, assignee, risk, capabilities, and proof schema from the original task unless the deterministic planner creates a validation task.

## Files

- Modify: `packages/core/src/types.ts`
  - Add `ReplanProposal`, `ReplanProposalStatus`, and `ReplanReplacementTask`.
- Modify: `apps/server/src/db/schema.ts`
  - Add `replan_proposals` table.
- Modify: `apps/server/src/db/repositories.ts`
  - Add CRUD helpers for proposals.
  - Add task dependency replacement helper.
- Create: `apps/server/src/runtime/replan.ts`
  - Build proposals and confirm proposals.
- Add tests: `apps/server/src/runtime/replan.test.ts`
- Modify: `apps/server/src/api/routes.ts`
  - Expose proposal list in company state.
  - Add `POST /api/tasks/:taskId/replan-proposals`.
  - Add `POST /api/replan-proposals/:proposalId/confirm`.
- Modify: `apps/dashboard/src/api/client.ts`
  - Add proposal types and client methods.
- Modify: `apps/dashboard/src/pages/CompanyOperations.tsx`
  - Show replan proposals and confirm button using existing panels/buttons/log components.
- Modify: `apps/dashboard/src/App.tsx`
  - Load proposals from state and wire confirm/generate actions.
- Modify: `apps/dashboard/src/ui/language/translations.ts`
  - Add replan proposal strings.
- Modify: `apps/dashboard/src/App.test.tsx`
  - Cover proposal display and confirmation.

## Task 1: Persist Replan Proposals

- [x] Write failing repository tests for create/list/update replan proposals and dependency rewiring.
- [x] Run: `pnpm --filter @auto-crop/server test -- src/db/repositories.test.ts`
- [x] Add core proposal types.
- [x] Add SQLite table and migration.
- [x] Add repository methods.
- [x] Run the repository tests again.

## Task 2: Generate And Confirm Proposals

- [x] Write failing `replan.test.ts` tests:
  - generating a proposal from `needs_replan`;
  - refusing proposal generation for non-`needs_replan`;
  - confirming creates sequential replacement tasks;
  - confirming rewires downstream dependencies to the final replacement task.
- [x] Run: `pnpm --filter @auto-crop/server test -- src/runtime/replan.test.ts`
- [x] Implement deterministic proposal builder and confirmation flow.
- [x] Run the replan tests again.

## Task 3: API Integration

- [x] Write failing route tests for proposal generation, company-state proposal listing, and proposal confirmation.
- [x] Run: `pnpm --filter @auto-crop/server test -- src/api/routes.test.ts`
- [x] Add routes and summary serialization.
- [x] Run route tests again.

## Task 4: Dashboard Integration

- [x] Write failing dashboard tests for proposal display and confirm action.
- [x] Run: `pnpm --filter @auto-crop/dashboard test`
- [x] Add API client methods, state wiring, and Company Operations proposal panel.
- [x] Run dashboard tests again.

## Final Verification

- [x] Run: `pnpm test`
- [x] Run: `pnpm typecheck`
- [x] Run: `git diff --check`
- [x] Run: `git status --short`

## Deferred

- Agent-generated replan proposals were deferred in this phase and implemented by the follow-up plan:
  `docs/superpowers/plans/2026-08-21-agent-generated-replan-proposals.md`.
