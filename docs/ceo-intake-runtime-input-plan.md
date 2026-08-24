# CEO Intake Runtime Input Plan

## Goal

Let users submit new vision, task, material, or direction from the CEO Workspace after a company already exists. The submission should become a durable CEO Intake, and the CEO Workspace should show a visible progress flow for how CEO Office is handling it.

This is the runtime counterpart to Founder Vision. It appends to company context and does not overwrite the original Founder Vision.

## Decisions

- CEO Workspace input creates a CEO Intake record.
- CEO Intake is persisted; it is not a frontend-only staged message.
- The first implementation does not invoke CEO Agent automatically.
- The first implementation does not automatically create objectives, tasks, dependencies, or department assignments.
- CEO Intake can later be consumed by CEO Agent or scheduler logic to plan and dispatch work.
- The CEO Workspace should reuse the existing message composer visual treatment used by department workspaces.
- Each intake should show a compact vertical flow, similar to department task progress.
- Each flow title should show a summary or truncated version of the user-submitted text.

## User-Facing Flow

After the user submits input in CEO Workspace, show a flow like:

```text
Request: Add a multiplayer competitive mode and build a prototype first.

✓ Received
● CEO assessing
○ Assessment complete
○ Planning
○ Generated objectives/tasks/department assignments
○ Dispatching
○ Dispatched to departments
```

If processing fails later, the flow should show `failed` clearly instead of silently disappearing.

## Flow States

Use this vocabulary for CEO Intake progress:

- `received`: CEO Office has received the user input.
- `assessing`: CEO Office is judging whether the intake is a vision update, task, material, constraint, or direction.
- `assessment_complete`: CEO Office has enough information to decide the next planning step.
- `planning`: CEO Office is producing objectives, tasks, dependencies, or department assignments.
- `planned`: a plan has been produced.
- `dispatching`: generated work is being written or assigned.
- `dispatched`: generated work has been assigned to departments or CEO tasks.
- `failed`: intake handling failed and needs retry or user attention.

## Data Model Notes

The first implementation should add a CEO Intake entity with at least:

- `id`
- `companyId`
- `body`
- `status`
- `createdAt`
- `updatedAt`

It may either store progress events separately or derive the first flow from `status`. Prefer a progress-event shape if it mirrors the existing department task progress model without forcing premature planner implementation.

## API Notes

Add API support for:

- creating a CEO Intake for a company
- returning CEO Intakes in the Company State Snapshot

The create endpoint should return the created intake so the dashboard can update immediately.

## Dashboard Notes

- CEO Workspace keeps its existing CEO/Agent summary.
- CEO Workspace adds a CEO Intake progress area.
- CEO Workspace adds a message composer using the same textarea and bottom-right send button treatment as department workspaces.
- Button copy should be `Send` / `发送`.
- Placeholder should explain that the input goes to CEO Office for evaluation, planning, and possible dispatch.
- Submitted intake flows should appear above the composer.

## This Version Does Not Do

- No automatic CEO Agent planning.
- No automatic objective/task/dependency creation from the intake.
- No replacement or deletion of existing objectives.
- No overwrite of Founder Vision.
- No user approval flow for generated plans yet.

## Verification

- Core schemas/types cover CEO Intake status vocabulary.
- Server tests cover creating and listing CEO Intakes.
- API tests cover CEO Intake creation and Company State Snapshot inclusion.
- Dashboard tests cover CEO Workspace composer submission and visible intake flow.
- Dashboard tests confirm CEO Workspace input is not a frontend-only staged message.

Run:

```bash
pnpm --filter @auto-crop/server test
pnpm --filter @auto-crop/server typecheck
pnpm --filter @auto-crop/dashboard test
pnpm --filter @auto-crop/dashboard typecheck
```
