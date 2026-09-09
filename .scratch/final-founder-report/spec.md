Status: complete

# Final Founder Report On Company Quiescence

Governing decision: `docs/adr/0018-final-founder-report-on-company-quiescence.md`. Glossary terms: `CONTEXT.md` (**Final Founder Report**, **Company Quiescence**, **Objective Stage Change**, **Task Outcome Summary**, **Task Completion Event**, **CEO Attention Item**, **CEO Attention Rollup**, **Wait State**, **Human Action**, **Founder Decision**, **Vision Gap**, **Business Artifact**, **Artifact Kind**, **Automatic Acceptance**, **Company State Snapshot**, **Localized Business Content**).

## Problem Statement

A founder enters a vision, the runtime splits it into departments and tasks, the tasks run, and every one of them completes. The founder opens CEO Office and cannot answer the one question that matters: *"I handed the work to the departments — what did they do, what did each one achieve, and what should I do next?"*

What they see instead: an empty Outcomes view (their company was upgraded and the ADR 0017 reconciliation left no Task Outcome Summaries), an "执行概览" of bare counts, and a handful of `INFORMATIONAL` CEO Attention Rollups that say `1 attention event(s) produced cross_department_impact across 3 task(s)` — mechanical noise, not a business read. There is no per-objective checkpoint while the company runs, and there is no closing summary when it finishes. ADR 0014 named a **Final Founder Report** and said it should be produced "when the Founder Vision is achieved, blocked, or enters a long-running Wait State"; that consequence was never built. `summarizeFounderReport` computes a data projection on every request, but nothing triggers it, narrates it, pushes it, or shows it in CEO Office — it renders only as a KPI panel on the operating dashboard.

## Solution

The runtime detects **Company Quiescence** — the company has no forward move left: nothing `queued`, `running`, or `waiting_dependency`, no Wait State checking in within a near horizon, and every remaining task terminal or parked on the founder. Reaching quiescence triggers a **Final Founder Report**: a CEO-Agent-authored, company-keyed record (its own `founder_reports` persistence, *not* a Business Artifact — a Business Artifact is task-bound and a report has no task) that states, in business language, the original Founder Vision, the actual result, each department's inputs and outputs, goal fit against the objectives and key results, the remaining Vision Gaps, and a recommended next step — classified as `achieved`, `stalled`, or `waiting`. It is generated as an async tracked job; while it runs, CEO Office shows a "closing report being prepared" state; if the authoring agent run fails past a retry ceiling, a deterministic report is assembled from Company State Snapshot data instead. The report is versioned by `isCurrent`: quiescence reached again after new work has run supersedes the previous report.

Between the silent routine task completion and the whole-company report, one middle signal is added: when the last task rolling up to an objective reaches a terminal state, the runtime emits an **Objective Stage Change** — a runtime-assembled CEO Attention Item (new `CeoAttentionRollupReason` value `goal_stage_change`) that condenses that objective's Task Outcome Summaries and key-result status. Routine per-task completions stay silent, as ADR 0014 and ADR 0017 decided.

In CEO Office: an `isCurrent` Final Founder Report renders as a panel pinned at the top, classification prominent, with a "report ready" signal over the existing SSE stream. `goal_stage_change` rollups render as achievements, not alarms. Once a company is quiescent, `cross_department_impact` rollups for already-accepted work are suppressed. The Outcomes view shows each entry's task description alongside its Task Outcome Summary, and carries a quiet "N new outcomes since your last visit" marker tracked in `localStorage`.

One time on upgrade, a company whose tasks are already all complete and which has no report gets the company-level report generated once from its accepted Business Artifacts. There is no per-task backfill.

## User Stories

1. As a founder, when every task in my company has finished, I want a single closing report, so that I understand what the company achieved without reading task logs.
2. As a founder, I want the closing report written in business language, so that I read a conclusion and a recommendation, not artifact metadata.
3. As a founder, I want the report to restate my original vision, so that I can judge the result against what I asked for.
4. As a founder, I want the report to describe the actual result in plain language, so that I know what was really produced.
5. As a founder, I want the report to break down what each department contributed, so that I can see where the work happened.
6. As a founder, I want the report to say how the result fits my objectives and key results, so that I know whether the company hit its goals.
7. As a founder, I want the report to list the remaining Vision Gaps, so that I do not mistake "all tasks done" for "vision achieved".
8. As a founder, I want the report to recommend a next step, so that I know what to do after reading it.
9. As a founder, I want the report to tell me whether the outcome was achieved, stalled, or waiting on me, so that I know at a glance which situation I am in.
10. As a founder whose company stalled on unrecoverable blocked tasks, I want a report anyway, so that I am not left inferring failure from activity.
11. As a founder whose company is only waiting on external timers weeks away, I want a report now rather than weeks of silence, so that I have closure and know the next milestone date.
12. As a founder whose company is parked on Human Actions or Founder Decisions, I want a report that says it is waiting on me and names what I need to do, so that I can unblock it.
13. As a founder, I want the report to appear pinned at the top of CEO Office, so that I do not have to go looking for it.
14. As a founder, I want a signal when the report becomes ready, so that I notice it without polling.
15. As a founder, I want CEO Office to show a "report being prepared" state between my company finishing and the report existing, so that I know one is coming.
16. As a founder, I want a report even when the CEO Agent fails to write one, so that a generation failure does not leave me with nothing.
17. As a founder who extends my company with more work after a report, I want a fresh report when the new work finishes, so that each report is a real checkpoint.
18. As a founder, I want older reports kept when a newer one supersedes them, so that I can see how the company progressed over time.
19. As a founder, while my company is still running, I want to hear from it once per objective rather than once per task, so that I get progress without a notification stream.
20. As a founder, I want the per-objective summary to roll up that objective's task outcomes and say whether its key results were met, so that I read progress toward the goal, not a task list.
21. As a founder, I want per-objective summaries styled as achievements, not alarms, so that CEO Office does not cry wolf on good news.
22. As a founder, I do not want every completed task to notify me, so that CEO Office stays a control surface and not an inbox.
23. As a founder looking at a fully-completed company, I do not want mechanical cross-department rollups cluttering CEO Office, so that the report is the thing I read.
24. As a founder, I want each Outcomes entry to show what the task was asked to do next to what it delivered, so that I can judge the outcome against the brief.
25. As a founder, I want a quiet marker of how many new outcomes appeared since I last looked, so that I can see there is new activity without being interrupted.
26. As a founder returning to an already-completed company that predates this feature, I want its closing report generated once, so that I am not permanently without one.
27. As a founder, I do not want completed tasks re-run just to produce summaries for old work, so that the upgrade does not burn agent time redoing finished work.
28. As a founder, I want the report and the per-objective summaries in my interface language, so that they read as business content, not English UI text.
29. As a CEO Agent, I want the report I author to be a first-class company-state record with its own versioning, so that it is durable and supersedable, not a transient log line — even though it is not a Business Artifact (it has no task).
30. As a developer, I want Company Quiescence computed from task and Wait State state rather than stored as a company status, so that it re-derives correctly and needs no migration.
31. As a developer, I want report generation to run as a tracked async job off the scheduler tick, so that a slow agent run does not stall the tick loop.
32. As a developer, I want the deterministic fallback report to reuse `summarizeFounderReport`, so that there is one factual data layer behind both the authored and fallback reports.
33. As a developer, I want `goal_stage_change` added to the CeoAttentionRollupReason vocabulary and its schema, so that the projection stays validated.
34. As a developer, I want the report classification to be a fixed enum in core, so that the dashboard and the report share one set of values.
35. As a developer, I want the cross-department-impact suppression scoped to quiescent companies and accepted work only, so that a running company still surfaces genuine cross-department signals.
36. As a developer, I want the "new outcomes" marker tracked client-side, so that the feature adds no server state for a single-founder convenience.
37. As an operator, I want the upgrade regeneration to be one-time and idempotent per company, so that re-running the runtime does not produce duplicate reports.
38. As an operator, I want the upgrade regeneration to skip companies that are not fully complete or already have a report, so that it only fills the genuine gap.

## Implementation Decisions

### Company Quiescence

- **Computed, not persisted.** A predicate over the company's tasks and projected Wait States. No new `CompanyStatus` value, no migration. Evaluated on the scheduler tick after task state has settled for that company.
- **Quiescent when:** no task is `queued`, `running`, or `waiting_dependency`; no projected Wait State has a `nextCheckAt` within a near horizon (a single tuned constant — start at 72 hours / "no check-in within 3 days"); and every remaining task is `complete`, or `retry_exhausted` / `blocked` with no path back to `queued` (no accepted upstream pending, no open replan), or parked on a pending Human Action or Founder Decision.
- **Classification** of the resulting report:
  - `achieved` — all or almost all key results `met`.
  - `waiting` — the only open items are Wait States (beyond the near horizon), Human Actions, or Founder Decisions.
  - `stalled` — one or more tasks are terminally blocked with no path forward and key results are not met.
- A company only quiescent because its Wait States check in *beyond* the near horizon is still quiescent; the report's recommended-next-step section names each pending Wait State and its `nextCheckAt`.

### Final Founder Report generation

- **Persistence.** A dedicated `founder_reports` record keyed by company: id, companyId, `classification`, the localized-text sections, `generatedBy`, `isCurrent`, `supersedesReportId`, timestamps. It is not a `business_artifacts` row — that table is task-bound (`task_id` required, `is_current` scoped per task). The `final_report` Artifact Kind stays defined but unused. No Artifact Validation, no Automatic Acceptance, no Task Completion Event — nothing reviews a CEO-authored report.
- **Trigger.** The first scheduler tick on which a company is quiescent and either has no `isCurrent` Final Founder Report, or has one but non-Wait-State work has completed since it was created (version supersession — see below). Enqueues a generation job; does not generate inline.
- **Job.** A tracked async unit of work, modelled on an Agent Run. It builds a report prompt, runs the company's selected CEO Agent through `agentSessionManager.run` in the company workspace (mirroring `generateCompanyBlueprint`), and parses a structured report payload from the agent's stdout.
- **Prompt inputs.** Founder Vision; objectives and key results with status; per-department task list with each task's description and Task Outcome Summary (or execution-failure facts for non-accepted tasks); accepted Business Artifact payloads; open Vision Gaps; pending Human Actions / Founder Decisions / Wait States; the computed classification.
- **Report payload.** The classification and the localized-text sections: `vision`, `actual_result`, `department_contributions` (list), `goal_fit`, `remaining_gaps`, `recommended_next_step`.
- **Failure.** Retry to a ceiling (reuse the Bounded Recovery ceiling pattern). On exhaustion, assemble a **deterministic report**: the `summarizeFounderReport` projection data rendered into the same payload shape, with the classification and every factual section populated and the synthesis sections (`actual_result`, `goal_fit`, `recommended_next_step`) filled from templates over Task Outcome Summaries and Vision Gaps rather than agent prose. The deterministic report is a persisted `founder_reports` record with `generatedBy: deterministic_fallback`.
- **Preparing state.** Between trigger and a finished artifact, the Company State Snapshot exposes a "report preparing" indicator (derived from the presence of an unfinished generation job), distinct from "no report".
- **Versioning.** When a new report is generated, the previous `founder_reports` record is set non-current (`supersedesReportId` on the new one points at it); the new one is `isCurrent`. Supersession fires only when non-Wait-State work has run since the last report (a CEO Intake turning into tasks, a replan, a recovered task) — a Wait State check-in that finds nothing changed does not supersede.
- **Push.** A new SSE event type (e.g. `company_report_ready`) published through the existing `EventStream` when a report record becomes `isCurrent`. The dashboard registers it and refetches Company State Snapshot, same as the other event types.

### Objective Stage Change

- **Emission.** Part of the CeoAttention projection (`projectCeoAttention`). For each objective, if every task whose `keyResultId` rolls up to that objective is in a terminal state (as defined for quiescence), the projection yields one CEO Attention Item with reason `goal_stage_change`, grouped by that objective (the existing `objective` rollup group).
- **Content.** Runtime-assembled, no agent: the objective's title, its key results and their status (`met` / `missed` / `active`), and a condensed read of the child tasks' Task Outcome Summaries. `recommendedNextAction` is derived (e.g. "review the objective outcome" or, if a key result is `missed`, name it).
- **Tasks with no `keyResultId`** do not contribute to any Objective Stage Change.
- **Severity** is `informational` — it is an achievement signal. The dashboard styles `goal_stage_change` rollups distinctly from exception rollups.
- **No persistence.** Like all CEO Attention Rollups, it is computed on read.

### CeoAttention changes

- Add `goal_stage_change` to `CeoAttentionRollupReason` (core type + zod schema).
- **Cross-department-impact suppression.** When the company is quiescent, `createAttentionCandidates` does not raise a `cross_department_impact` reason for a Task Completion Event whose task is `complete` and whose downstream is also settled. A non-quiescent company is unchanged — genuine in-flight cross-department signals still surface. This is the only change to existing rollup behaviour.
- The `exception_outcome` and other existing reasons are untouched.

### Core schema

- New `finalFounderReportClassification` union: `achieved` | `stalled` | `waiting`, with a zod schema.
- New `FinalFounderReport` core type + zod schema for the record: id, companyId, classification, the six localized-text sections, `generatedBy` (`ceo_agent` | `deterministic_fallback`), `isCurrent`, `supersedesReportId`, timestamps.
- `goal_stage_change` in `ceoAttentionRollupReasonSchema`.

### Company State Snapshot serialization

- `buildCompanyState` exposes the `isCurrent` Final Founder Report (its sections + classification + `generatedBy`), the "report preparing" indicator, and — via the existing `ceoAttentionRollups` field — the `goal_stage_change` rollups.
- `summarizeFounderReport` is kept as-is and becomes the documented data source for the deterministic fallback; it is no longer the only "report" the dashboard has.

### Upgrade regeneration

- One-time, idempotent per company, on the scheduler tick (alongside the existing ADR 0017 review reconciliation). For a company that is quiescent, has every task `complete`, and has no Final Founder Report: enqueue one report generation job. A per-company marker makes every later tick a no-op.
- Does not touch companies with blocked/stalled tasks (they get a normal report on their next quiescent tick), companies that already have a report, or per-task Task Outcome Summaries for old tasks.

### Dashboard — CEO Office

- **Final Founder Report panel**, pinned above the Outcomes view when an `isCurrent` report exists. Shows the classification prominently, then the sections. When the "report preparing" indicator is set and no report exists yet, the panel shows the preparing state.
- **`goal_stage_change` rollups** render in the existing CEO Attention Rollup section with achievement styling (distinct from the exception rollups).
- **Outcomes view**: each entry additionally shows the task's description/objective next to its Task Outcome Summary. The 4-part Task Outcome Summary contract is unchanged.
- **"N new outcomes since your last visit"** marker on the Outcomes view, plus unseen state on the report banner and `goal_stage_change` rollups, computed against a `localStorage` last-seen timestamp per company. Reads and writes wrapped so a private window / cleared storage degrades to "nothing new".
- **SSE**: register `company_report_ready` in the dashboard event client so it triggers a Company State Snapshot refetch.
- Reuse existing retro primitives (`RetroPanel`, `VideotexKeyValue`, `RetroBadge`, etc.) per the `CONTEXT.md` UI Implementation Rule.

## Testing Decisions

A good test here asserts externally observable outcomes: the persisted Final Founder Report record and its sections, its `isCurrent` transitions and `generatedBy`, the emitted SSE event, the projected `ceoAttentionRollups` (reasons, grouping, presence/absence), the serialized Company State Snapshot fields, and rendered dashboard state. It never asserts private helper names, the exact near-horizon constant, rollup sort order beyond the user-visible priority rule, or prompt wording. Prefer driving tasks through the real scheduler over unit-testing the quiescence predicate or the projection in isolation.

### Seam 1 — `runSchedulerOnce` (`apps/server/src/runtime/scheduler.test.ts`)

Prior art: existing `scheduler.test.ts` dispatch / acceptance / wait-state cases; `createCompany.test.ts` for the CEO-adapter-run-and-parse pattern (use the same fake adapter approach for the report-authoring run).

- A company whose every task reaches `complete` through the scheduler becomes quiescent on the next tick, a report generation job is created, the fake CEO adapter's run produces an `isCurrent` Final Founder Report record, and a `company_report_ready` event is emitted.
- A company with a `queued` / `waiting_dependency` task is not quiescent and no report job is created.
- A company whose only open item is a Wait State with a near-horizon `nextCheckAt` is not quiescent; the same company with the check-in beyond the horizon is quiescent and its report classifies as `waiting`.
- A company with a terminally `blocked` task and unmet key results produces a report classified `stalled`.
- A company with all key results `met` produces a report classified `achieved`.
- When the fake CEO adapter fails every attempt, a deterministic fallback Final Founder Report record is still produced and marked `generatedBy: deterministic_fallback`.
- After a report exists, running and completing a new task (simulating post-report work) triggers a second report; the first record is now non-current, the second `isCurrent`. A bare Wait State check-in that changes nothing does not trigger a new report.
- When an objective's last contributing task goes terminal, the tick's projection yields a `goal_stage_change` rollup for that objective; tasks with no `keyResultId` do not.
- Once a company is quiescent, `cross_department_impact` rollups for its accepted tasks are gone; a non-quiescent company with in-flight cross-department work still has them.
- The upgrade regeneration path: a pre-existing all-`complete` company with no report gets exactly one report on the first tick, and re-running the tick produces no second report.

### Seam 2 — Company State Snapshot via the HTTP route (`apps/server/src/api/routes.test.ts`)

Prior art: existing `founderReport`, wait-state routing, and ceo-attention route tests (`routes.test.ts` around lines 954, 1725, 2095).

- The company-state response serializes an `isCurrent` Final Founder Report with its classification and all six sections.
- During the generation gap, the response exposes the "report preparing" indicator and no report; after generation, the indicator is clear and the report is present.
- `ceoAttentionRollups` in the response includes a `goal_stage_change` rollup with the owning objective and its affected tasks when an objective is complete, and excludes it when the objective still has running tasks.
- The response omits `cross_department_impact` rollups for accepted work when the company is quiescent.
- After a superseding report is generated, the response's report is the new one and the non-current reports list still contains the old one.

### Seam 3 — Dashboard CEO Office (`apps/dashboard/src/App.test.tsx`)

Prior art: existing App-level CEO workspace flow tests.

- Given a snapshot with an `isCurrent` Final Founder Report, the pinned panel renders above Outcomes with the classification visible and the sections shown.
- Given the "report preparing" indicator and no report, the panel shows the preparing state.
- `goal_stage_change` rollups render with achievement styling and are visually distinct from exception rollups.
- Each Outcomes entry shows the task description alongside its Task Outcome Summary.
- The "N new outcomes" marker reflects a stubbed `localStorage` last-seen value and clears after a visit; with no/blocked storage it shows nothing new rather than erroring.
- A quiescent-company snapshot with no `cross_department_impact` rollups renders no such rollup entries.

### Seam 4 — SSE client (`apps/dashboard/src/api/client.test.ts`)

Prior art: the existing `FakeEventSource` test.

- The client registers a `company_report_ready` listener and, on that event, invokes the state-refetch path.

### Seam 5 — Core schema (`packages/core/src/schemas.test.ts`)

Prior art: `schemas.test.ts:244` (`strategicDecisionKindSchema`).

- `goal_stage_change` parses as a valid `CeoAttentionRollupReason`; an unknown reason does not.
- Each `finalFounderReportClassification` value parses; an unknown value does not.
- A well-formed Final Founder Report payload (classification + six sections + `generatedBy`) parses; one missing a required section does not.

## Out of Scope

- Wiring a CEO Intake into new planning (turning founder follow-up into new tasks). The report-versioning design is forward-compatible with it, but the planning path is a separate effort.
- OS / browser / email notification. The push is the SSE event plus the CEO Office surface only.
- Any revision of how the CEO Agent assigns task `riskLevel` or its planning prompt.
- Direction Drift detection and the unproduced `validationStatus` values (`invalid_drift`, `invalid_blocker`, `stale`). The Final Founder Report deliberately omits a "drift status" section until Direction Drift exists.
- Per-task backfill of Task Outcome Summaries for tasks completed before this feature or before ADR 0017.
- A new `CompanyStatus` value for "done" — quiescence stays computed.
- Server-side "seen" tracking or multi-device sync of the "new outcomes" marker.
- Letting the founder request a regenerated report on demand, or edit / annotate a report after the fact.
- Reworking the CEO Attention Rollup summary strings for the existing reasons (only `goal_stage_change` and the quiescence suppression change rollup behaviour).

## Further Notes

This spec builds the Final Founder Report consequence that ADR 0014 named and ADR 0017 left standing, and it closes the gap the founder hit in testing: a fully-completed company with nothing to read. It also partially redeems two glossary promises the code never kept — `goal_stage_change` as a real CEO Attention reason, and the "executive summary" (the report itself) as a real interruption-worthy item.

The load-bearing constraint from ADR 0014 / 0017 is unchanged: routine task completions stay silent. The Objective Stage Change is the deliberate middle ground — the founder hears from the company a handful of times (once per objective, once at the end), never once per task. Anyone later tempted to add a per-task completion feed should read ADR 0014, ADR 0017, and ADR 0018 first.

The first-time-post-creation CEO Agent execution is a real new capability. It is bounded to report authorship here; it is also the mechanism a future CEO-Intake-into-planning effort would extend.

The near-horizon constant for "a Wait State that still counts as scheduled work" is a tuning parameter. Start at 72 hours; the tests must not pin the exact value, only the two sides of the boundary.
