# CEO Office Business Outcomes Plan

## Status

Planned. Governing decision: `docs/adr/0017-ceo-office-surfaces-business-outcomes.md`. This plan is the input to `/to-spec` and `/to-tickets`; it is a multi-session build.

## Goal

Make CEO Office read as company state rather than an approval inbox:

- Internal deliverables are accepted automatically by default, with no CEO click.
- The one thing a completed task puts in front of the founder is a **Founder Decision**: a pick among viable options for a strategic decision the runtime must not make on its own.
- What the founder reads about a completed task is its **Task Outcome Summary** — the conclusion and what it means for the objective — not the proof file, workspace path, and validation status behind it.

## Non-Goals

- No schema registry, no per-task-type inherited-decision-field declarations, no Direction Drift detection. `invalid_drift`, `invalid_blocker`, and `stale` stay defined-but-unproduced.
- No revision of the CEO Agent's `riskLevel` assignment or its planning prompt.
- No Founder Approval machinery (central trigger list, `approvalRequired` wiring).
- No split of `tasks.status` into execution / review / business columns.
- No full CEO Office home redesign; the Outcomes view is an addition, and the existing queues stay.
- No data backfill for tasks that are already `complete`.

## Key Decisions

See ADR 0017 for the reasoning. Summary:

- Remove the `isMarkedForInternalAutomaticAcceptance` opt-in gate from `evaluateAutomaticAcceptance`.
- Acceptance is deterministic: valid + reviewable artifact, no risk-pattern hit, no Founder Approval action, no unresolved Founder Decision.
- `riskLevel` is demoted to a planning hint; it is not an acceptance gate.
- Founder Decision is a new `NextStepItemType` (`founder_decision`) projected into a first-class `FounderDecision`, scoped by a fixed `StrategicDecisionKind` enum in core.
- Resolving a Founder Decision is the acceptance of its deliverable; there is no separate approve step.
- New `acceptanceProvenance` value `founder_decision`.
- Task Outcome Summary is a new localized-text field on `TaskCompletionEvent`, produced by the completing agent.
- CEO Office gains an Outcomes view; manual review narrows to risk-pattern-caught deliverables; the review panel leads with the conclusion.

## Core Type Changes (`packages/core`)

- `NextStepItemType`: add `"founder_decision"`. Update `nextStepItemTypeSchema` in `schemas.ts`.
- `TaskAcceptanceProvenance`: add `"founder_decision"`. Add a dedicated zod schema if one is introduced.
- New `StrategicDecisionKind` union + zod schema. Seed values: `target_market`, `product_direction`, `mvp_type`, `pricing_model`, `launch_target`.
- New `FounderDecision` type (projected object): id, companyId, sourceTaskCompletionEventId, taskId, departmentId, `decisionKind`, `options` (each with label, tradeoffs, and whether it is the recommendation), `rationale`, `status` (`pending` / `resolved` / `returned`), `resolvedOption`, `resolvedAt`, blockedTaskIds, createdAt. Mirror the `HumanAction` shape.
- `TaskCompletionEvent`: add `outcomeSummaryText: LocalizedText | null` (and any structured `resolvedFounderDecisions` record needed for the handoff payload).
- `NextStepItem`: the `founder_decision` item carries `decisionKind`, `options`, `recommendation`, `rationale` (via existing `dependencyImpact` / new fields as fits the existing pattern).

## Phase A — Acceptance

### A1. Deterministic Automatic Acceptance

- `apps/server/src/runtime/automaticAcceptance.ts`: remove `isMarkedForInternalAutomaticAcceptance` and the `riskLevel !== "low"` early return. Keep `isReviewableBusinessArtifact`. Keep the risk-pattern scan.
- Tighten `FORBIDDEN_RISK_PATTERNS`: replace broad single-word patterns (`\baccount\b`, `\bpermission\b`, `\bads?\b`, `\bdomain\b`) with precise phrases (`create .* account`, `account permissions`, `grant .* access`, `connect .* (ads|advertising) account`, `custom domain`, `production domain`, …). The scan is a safety net, not the primary rule.
- Add the "no unresolved Founder Decision" condition (depends on A3).
- `evaluateAutomaticAcceptance` return stays `{ kind: "accept" } | { kind: "requires_review"; reason }`; `requires_review` now means "risk-pattern hit" almost exclusively.

### A2. Strategic Decision Kind + `open_decisions` parsing

- Add `StrategicDecisionKind` to core (above).
- `apps/server/src/runtime/businessArtifact.ts`: parse an optional `open_decisions` array from the artifact JSON. Validate each entry: `decisionKind` in the enum, `options.length > 1`, each option has a label, exactly one option flagged as the recommendation, non-empty `rationale`. Entries with an unknown `decisionKind` are dropped (not an error). Malformed entries on a known `decisionKind` are a structural validation failure, like other required-field failures.
- `apps/server/src/runtime/scheduler.ts` `buildAgentPrompt`: add an `## Open Decisions` instruction block telling the agent to declare, in `open_decisions`, any choice it is making on a Strategic Decision Kind, with options / tradeoffs / recommendation / rationale — and that such a choice is the founder's to make.

### A3. Founder Decision Next Step Item + projection

- `apps/server/src/runtime/taskCompletion.ts` / wherever Task Completion Events are built: turn each parsed `open_decisions` entry into a `founder_decision` `NextStepItem` on the event.
- `apps/server/src/runtime/ceoAttention.ts`: add `collectFounderDecisions(event, resolutions)` mirroring `collectHumanActions`; return `founderDecisions` from `projectCeoAttention`. Add `founder_decision` as a `CeoAttentionRollupReason` and include unresolved Founder Decisions in `createAttentionCandidates`.
- Persisted state: a `founder_decision_resolutions` table (or reuse the human-action-confirmation pattern) keyed by the projected FounderDecision id, storing the picked option, actor, timestamp.

### A4. Gate acceptance on Founder Decisions

- `apps/server/src/runtime/scheduler.ts` around line 528: before `evaluateAutomaticAcceptance`, check whether the artifact declares any `open_decisions` on known `decisionKind`s. If yes and unresolved, do not auto-accept and do not send to manual review — move the task to `review`-equivalent only for the Founder Decision surface (or a dedicated status-free projection), emit the Task Completion Event with the `founder_decision` items and the Task Outcome Summary, and stop.
- Downstream readiness (`dependencyReadiness.ts`) already blocks on a non-accepted upstream; add the derived "waiting on decision" note when the block is due to an unresolved Founder Decision.

### A5. Resolve a Founder Decision

- New API: `POST /api/founder-decisions` accepting `{ founderDecisionId, chosenOptionId }` or `{ founderDecisionId, action: "return", note, returnReason }`.
- On a pick: record the resolution; write the chosen value into the artifact payload under its `decisionKind`; if every Founder Decision on the task is now resolved, run the existing `businessAcceptance` seam with `acceptanceProvenance: "founder_decision"`; the resolved values flow into the handoff via the normal Task Completion Event / cascade path.
- On a return: mark the task returned to the department (reuse the CEO-review return path), discard recorded picks for that task, write a department progress event.
- Reject stale resolutions (task no longer awaiting the decision) with `409`.

### A6. Migration reconciliation

- One-time on deploy: for every task currently in `review`, run the deterministic acceptance check. Accept the qualifying ones through the `businessAcceptance` seam with provenance `automatic_acceptance` and no `outcomeSummaryText`. Leave the rest in `review` for the restructured manual panel.
- Idempotent; safe to run once. Do not touch `blocked` / `complete` tasks. Do not migrate the known stuck company.

## Phase B — Information presentation

### B1. Task Outcome Summary

- Add `outcomeSummaryText` to `TaskCompletionEvent` (core type, zod, DB column + migration, repository mapping, `summarizeTaskCompletionEvent`).
- `buildAgentPrompt`: add a `## Task Outcome Summary` instruction block with the four-part contract (conclusion; meaning for the objective; remaining gap; and — only if there is a Founder Decision — options, tradeoffs, recommendation).
- `businessArtifact.ts`: require an `outcome_summary` field (localized or plain string) on `deliverable` / `final_report` artifacts; missing → structural validation failure. Carry it onto the Task Completion Event at build time.

### B2. Outcomes view

- New dashboard component under `apps/dashboard/src/pages` (or a section of `CeoIntakeWorkspace`): list recent Task Completion Events grouped by objective, each rendering `outcomeSummaryText` and dependency impact in business language. Pin unresolved Founder Decisions at the top with their options, recommendation, and a pick / return control wired to `POST /api/founder-decisions`.
- Store `taskCompletionEvents` in dashboard app state (currently unused) and pass to the view.
- Demote the Review / Decision / Blocked queues to a secondary position on the CEO surface; do not remove them.
- Add a "waiting on decision" label to the CEO Task Dependency Graph for downstream nodes blocked on an unresolved Founder Decision.

### B3. Restructure the review detail panel

- `apps/dashboard/src/pages/DepartmentWorkspace.tsx` `CeoTaskReviewDetail`: lead the panel with `outcomeSummaryText`. Move the current `部门提交内容` content (proof summary, `proofType / proof.uri`, artifact kind/role/subtype, validation/review status) into a collapsed "证据与校验 / Evidence & Validation" section.
- `getCeoPendingItems`: this queue now contains only risk-pattern-caught deliverables; adjust copy accordingly.

### B4. Attention + company state

- `buildCompanyState` (`routes.ts`): serialize `founderDecisions` from `projectCeoAttention`; keep `taskCompletionEvents` serialized with the new field.
- `CompanyOperations` "Agent Activity": add a case for `automatic_acceptance` / `founder_decision` / `ceo_review_decision` events so they render as readable business language, not `formatCodeLabel(event.status)`.

## Verification

Server:

- `evaluateAutomaticAcceptance` accepts a valid low-stakes deliverable with no marker and no `riskLevel === "low"`.
- `evaluateAutomaticAcceptance` still refuses a deliverable whose text hits the tightened risk patterns, and the tightened patterns do not fire on ordinary product-brief / research language (regression fixtures).
- A deliverable declaring an `open_decisions` entry on a known `decisionKind` does not auto-accept; it produces a Task Completion Event carrying a `founder_decision` Next Step Item and the Task Outcome Summary.
- An `open_decisions` entry on an unknown `decisionKind` is dropped and the deliverable auto-accepts.
- `POST /api/founder-decisions` with a pick resolves the decision, writes the value into the artifact payload, and — when it is the last open decision — runs `businessAcceptance` with provenance `founder_decision` and cascades downstream.
- `POST /api/founder-decisions` with a return sends the task back to the department and discards picks.
- Multiple Founder Decisions on one task: acceptance only after all are resolved.
- `projectCeoAttention` emits an unresolved Founder Decision as a `founder_decision` attention rollup reason; a resolved one is absent.
- Downstream `dependencyReadiness` reports "waiting on decision" when the block is an unresolved Founder Decision.
- Migration reconciliation accepts a qualifying `review` task once and is idempotent; leaves a risk-pattern-caught `review` task in place.
- `buildCompanyState` serializes `founderDecisions` and `outcomeSummaryText`.

Dashboard:

- Outcomes view renders Task Outcome Summaries grouped by objective and pins unresolved Founder Decisions with working pick / return controls.
- Review detail panel leads with the conclusion; evidence/validation is collapsed.
- CEO Task Dependency Graph shows "waiting on decision" for the right nodes.
- Review / Decision / Blocked queues remain reachable.

Run:

```bash
pnpm --filter @auto-crop/core test
pnpm --filter @auto-crop/core typecheck
pnpm --filter @auto-crop/server test
pnpm --filter @auto-crop/server typecheck
pnpm --filter @auto-crop/dashboard test
pnpm --filter @auto-crop/dashboard typecheck
```

## Follow-On Work

- Build the schema registry and Direction Drift detection; re-express Strategic Decision Kind against declared inherited decision fields once they exist.
- Build the Founder Approval trigger list and wire `approvalRequired`, closing the first-value / later-change split.
- Re-prompt the CEO Agent with explicit `riskLevel` criteria, or remove `riskLevel` from the task model.
- Let the founder mark an auto-accepted outcome for follow-up or request rework without deleting history.
