# Final Founder Report Is Produced When A Company Goes Quiescent

Auto-Crop will detect when a company has no forward move left — nothing queued, running, or waiting on the runtime, every remaining task terminal or parked on the founder — and treat that moment as the cue to produce a **Final Founder Report**: a CEO-Agent-authored Business Artifact that states, in business language, what the vision was, what the company actually achieved, how each department contributed, the remaining gaps, and a recommended next step, classified as **achieved**, **stalled**, or **waiting-on-you**. Between the whole-company report and the silent per-task completion, a middle signal is added: when the last task under an objective reaches a terminal state, a runtime-assembled **Objective Stage Change** rolls that objective's outcomes up as a single CEO Attention Item. Routine per-task completions stay silent, as ADR 0014 and ADR 0017 decided.

## Context

ADR 0014 named the **Final Founder Report** and said it "should be generated when the Founder Vision is achieved, blocked, or enters a long-running Wait State, not merely when a set of tasks reaches `complete`." That consequence was never built. `summarizeFounderReport` computes a data projection (counts and arrays) on every state request, but nothing triggers it, narrates it, pushes it, or surfaces it in CEO Office — it renders only as a KPI panel in the operating dashboard.

The observed failure: a founder runs a full vision, all nine tasks complete, and CEO Office shows an empty Outcomes view (the company was upgraded and the ADR 0017 reconciliation wrote no Task Outcome Summaries) plus three mechanical `cross_department_impact` attention rollups. There is no answer to "I split the work up and handed it to the departments — what did they do, what did they achieve, and what's next."

The CEO Agent currently runs exactly once, at company creation. A CEO Intake is stored but never processed into new work.

## Considered Options

- **Leave `summarizeFounderReport` as the report:** it already has the factual skeleton. But it is counts, not synthesis; its "next step" is a mechanical list of open Vision Gaps; it is never pushed and lives on the wrong screen. It does not answer the founder's question.
- **Push every task's Task Outcome Summary to CEO Office on completion:** gives maximum visibility, but this is precisely the "noisy message stream that keeps the founder in a low-leverage approval posture" ADR 0014 rejected and ADR 0017 doubled down on ("silence is the default for routine work"). Reversing that for an informational stream still trains the founder to watch a feed.
- **Only generate a report when all key results are met:** clean success summary, but a company that stalled or parked on external waiting is exactly when the founder is most blind, and gets nothing.
- **Generate the report deterministically from a template (no agent):** cheap and reliable, but the sections the founder is missing — the plain-language result, the goal-fit read, and the recommended next step — are business judgement a template cannot produce.
- **A synthetic CEO task run through the scheduler:** would reuse task execution, but every task needs a `departmentId` and CEO is a role, not a department; the fit is poor.
- **Detect quiescence, run the CEO Agent to author a first-class report, and add one rolled-up signal per objective:** covers success, dead-end, and parked; delivers synthesis where it matters; keeps the per-task surface silent.

## Decision

Adopt quiescence-triggered, CEO-Agent-authored Final Founder Reports, plus runtime-assembled Objective Stage Changes.

### Company Quiescence

A company is **quiescent** when all of the following hold:

- no task is `queued`, `running`, or `waiting_dependency`;
- no live Wait State has a check-in within a near horizon (a short, spec-tuned window — scheduled work is still work);
- every remaining task is terminal: `complete`; `retry_exhausted` / `blocked` with no path back to `queued`; or parked on a Human Action or Founder Decision, which wait on the founder indefinitely.

Quiescence is computed, not a persisted company status. A company that is quiescent only because its remaining Wait States check in **beyond** the near horizon is still quiescent — weeks of dashboard silence is the problem being solved, and the report's next-step section names each pending Wait State and its check-in date.

### Final Founder Report

- **Record.** The report is a **dedicated `founder_reports` record keyed by company**, carrying the classification, the localized sections, a `generated_by` marker, and its own `isCurrent` / supersession. It is *not* a `business_artifacts` row. The grilling chose "first-class Business Artifact", but exploration found every Business Artifact in the codebase is task-bound — `taskId` is a required column and `is_current` is scoped `WHERE task_id = ?` — and a company-level report has no task. Artifact Validation and Automatic Acceptance are vacuous for a CEO-authored report that nothing reviews, and lineage citability only matters for the out-of-scope iterate-after-report loop. So the report gets a task-agnostic record of its own; the `final_report` Artifact Kind stays defined but unused. This is a refinement of the "first-class" intent — the report is still a first-class company-state object — not a downgrade to a log line.
- **Author.** A dedicated CEO Agent run, mirroring `generateCompanyBlueprint`: a built prompt, the company workspace, an `agentSessionManager.run` with the selected CEO Agent, a parsed structured result. This is the first post-creation CEO Agent execution path.
- **Content.** Original Founder Vision; the actual result in plain language; each department's inputs and outputs; goal fit against the objectives and key results; remaining Vision Gaps; a recommended next step; and a **classification** of `achieved` / `stalled` / `waiting`. All localized-text (`{ en, zh }`) as Localized Business Content. The "drift status" field named in the ADR 0014 glossary entry is dropped — Direction Drift is never produced by any code path, so the field would always read "none"; re-add it if Direction Drift is ever built.
- **Generation is an async tracked job**, not inline in the scheduler tick. Between quiescence and a finished report, CEO Office shows a "closing report being prepared" state. On agent failure, retry to a ceiling, then fall back to a **deterministic report** — the `summarizeFounderReport` data rendered with the classification and factual sections, without the narrative synthesis. The founder is never left with nothing.
- **Versioning.** Each time a company goes quiescent *after new work has run* since the last report, a new `founder_reports` record is produced and the previous one is retained non-current. This is forward-compatible with an iterate-after-report loop; wiring a CEO Intake into new planning is **out of scope** here.
- **Upgrade regeneration.** One time, for a company whose tasks are already all complete and which has no report, the company-level report is generated once from the accepted Business Artifacts that already exist. There is **no per-task backfill** — re-running completed tasks' agents to synthesize Task Outcome Summaries is the expense ADR 0017 correctly avoided.

### Objective Stage Change

- When the last task whose `keyResultId` rolls up to an objective reaches a terminal state, the runtime emits one **Objective Stage Change**: a CEO Attention Item, new `CeoAttentionRollupReason` value `goal_stage_change` (already named in the `CEO Attention Item` glossary entry, never implemented), grouped by that objective.
- **Runtime-assembled, no agent.** It condenses the objective's child Task Outcome Summaries and its key-result status. There can be many objectives; the CEO Agent call is reserved for the whole-company report.
- Tasks with no `keyResultId` do not trigger one. The upgrade regeneration produces only the company-level report, not historical Objective Stage Changes.

### CEO Office surface

- An `isCurrent` Final Founder Report renders as a panel **pinned at the top of CEO Office**, classification prominent, with a "report ready" signal delivered over the existing SSE event stream (`/api/events`) as a new event type. No OS or email notification in v1.
- `goal_stage_change` rollups flow into the existing CEO Attention Rollup section, styled as an achievement rather than an alarm.
- **Once a company is quiescent, `cross_department_impact` attention rollups for already-accepted work are suppressed** — they are mechanical and redundant with the report. This removes the observed noise.
- A light "N new outcomes since your last visit" marker on the Outcomes view, plus the unseen state of `goal_stage_change` rollups and the report banner, are tracked **client-side in `localStorage`**. One founder, a per-view convenience, zero new server state; "new" counts reset across browsers, which is acceptable.

## Consequences

- **CEO Office finally answers "what did the company achieve and what's next."** For a quiescent company the founder reads one synthesized report; while the company runs, they hear from it roughly once per objective, never once per task.
- **This is the first time the CEO Agent runs after company creation.** A future reader seeing an `agentSessionManager.run` outside `generateCompanyBlueprint` should expect it: report authorship is a deliberate, bounded second use, not scope creep.
- **The per-task surface stays silent by design.** ADR 0014 and ADR 0017's "routine completions do not interrupt" is unchanged. Anyone tempted to add a per-task completion feed should read those two ADRs and this one first — per-objective rollup is the settled compromise.
- **One new persisted table.** `founder_reports` (company-keyed, classification + localized sections + `generated_by` + `isCurrent`). `goal_stage_change` is a computed projection value, not a migration. No new company status. The `final_report` Artifact Kind stays defined but unused.
- **`summarizeFounderReport` is kept**, demoted to the deterministic data layer behind the report and its failure fallback.
- **Quiescence can be reached more than once per company**, so a long-running company accumulates several report versions — each a real checkpoint.
- **The ADR 0014 glossary promises are now partly kept:** `goal_stage_change` and the "executive summary" (the report itself) become real CEO Attention reasons. "Drift status" in the Final Founder Report is explicitly abandoned until Direction Drift exists.
- **Out of scope and still open:** CEO Intake → new planning; OS/email push; any revision of how the CEO Agent assigns `riskLevel`; Direction Drift and the unproduced `validationStatus` values.
