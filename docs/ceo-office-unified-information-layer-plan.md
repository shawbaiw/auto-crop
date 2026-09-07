# CEO Office Unified Information Layer Plan

## Status

Planned. Governing decision: `docs/adr/0019-ceo-office-unified-information-layer.md`.

## Goal

Make CEO Office present macro business information through one reusable abstraction instead of patching individual test cases or UI sections. A user should be able to switch from the current SEO example to pricing, MVP definition, customer research, launch planning, or another case and still see the same clear flow: task brief, any CEO action item, execution report, and higher-level stage changes in chronological order.

## Non-Goals

- Do not add SEO-specific UI logic, copy, artifact-subtype handling, or fixture-dependent display rules.
- Do not show low-level execution details in the CEO Office Timeline: task start, retry, proof capture, workspace path, raw logs, agent diagnostics, and proof validation details stay in task details or diagnostic surfaces.
- Do not add a persisted `ceo_office_items` table in the first implementation.
- Do not remove the existing Outcomes, Pending, Attention, Human Action, Wait State, and Final Founder Report sections in the first pass.

## Information Model

Introduce a projected `CEOOfficeItem` union. The first pass should cover:

- `task_brief`: task purpose, expected output, vision/objective link, dependencies, and planned next step.
- `execution_report`: conclusion, vision impact, remaining gap, and recommendation, with expandable evidence links when available.
- `decision_request`: a founder/CEO choice such as target market, product direction, MVP type, pricing model, launch target, or another accepted Strategic Decision Kind.
- `approval_request`: an approve/return gate for a reviewable deliverable or later high-impact change.
- `decision_resolution`: the timeline record that a pending decision, approval, or return was settled.
- `human_action`: an external action the human must take.
- `wait_state`: an external wait that is not a failure.
- `blocked_issue`: a blocker, retry-exhausted task, missing deliverable, needs-replan outcome, or unrecoverable failure.
- `stage_change`: an objective-level milestone, not owned by one task.
- `final_report`: the company-level report produced on quiescence.

`task_brief` and `execution_report` are required for every task going forward. Execution-time action items are optional and appear only when the task actually needs CEO movement.

## Projection Sources

Build the first implementation from existing durable facts:

- Tasks and task dependencies for Task Briefs.
- Department assessment and progress events when available, with task definition fallback.
- Task Completion Events and Business Artifacts for Execution Reports.
- Founder Decisions and CEO Review Decisions for decision requests and resolutions.
- Human Actions, Wait States, Vision Gaps, and blocked task state for attention items.
- CEO Attention Rollups for stage changes and exceptional grouped context.
- Final Founder Reports for company-level summaries.

The projection should expose stable IDs derived from source facts so repeated state reads do not produce duplicate UI rows.

## Timeline Rules

- Sort CEO Office Timeline items globally by occurrence time.
- Show only already-happened macro nodes in the Timeline.
- Put future or not-yet-started work in execution status or task relationship views, not the Timeline.
- Insert `stage_change` by time as a milestone row.
- If a task completion creates both an Execution Report and a decision request, order the Execution Report first.
- A resolved decision updates the original pending item and also appends a `decision_resolution` item.
- The same pending item may appear in both the top pending summary and the Timeline; the former is an action shortcut, the latter is historical context.

## CEO Office Layout

Use the existing dashboard style and reusable retro UI primitives.

First screen order:

1. Company state summary.
2. CEO pending summary containing only items that need action.
3. CEO Office Timeline showing Task Briefs, action items, Execution Reports, stage changes, and final reports in order.

Existing sections should remain below or alongside the new surface during the first pass. Once the unified Timeline proves it covers multiple test cases, duplicated sections can be consolidated.

## Structured Reports

New Execution Reports should prefer structured fields:

- `conclusion`
- `visionImpact`
- `remainingGap`
- `recommendation`

Fallback behavior should read existing `outcomeSummaryText` so older data remains usable. This fallback is compatibility only; new task outputs should be validated against the structured contract.

Task Briefs can initially be projected from task title, description, objective/key result, dependencies, and proof expectations. Future direction: department assessment should produce structured Task Brief fields so the pre-execution read reflects the department's confirmed understanding, not only the CEO Agent's original assignment.

## Implementation Phases

### Phase 1: Projection Contract

- Add the shared CEO Office Item types in the core/shared contract area.
- Implement `projectCeoOfficeItems` behind a small interface.
- Unit test it with at least three non-SEO scenarios: pricing, MVP definition, and launch or customer research.
- Assert every task has a Task Brief and Execution Report item when the required source facts exist.
- Assert Pending contains only action-bearing items.

### Phase 2: API State

- Add the projected CEO Office Items to company state.
- Keep existing fields for backward-compatible UI sections.
- Ensure stable ordering and stable IDs across repeated reads.

### Phase 3: Dashboard Timeline

- Add the CEO Office Timeline to the CEO workspace.
- Render item types generically from the item contract.
- Keep task details and diagnostics out of the Timeline.
- Add dashboard tests that use different business domains and fail if special-case SEO copy is required.

### Phase 4: Structured Output Contract

- Extend Business Artifact / task completion parsing to accept structured Execution Report fields.
- Preserve `outcomeSummaryText` fallback for old data.
- Update task prompts so agents produce structured Execution Reports.
- Later, extend department assessment so Task Briefs become structured instead of mostly projected from task definitions.

### Phase 5: Consolidation

- Compare Timeline coverage against Outcomes, Attention Rollups, CEO Pending, Human Actions, Wait States, and Final Founder Report panels.
- Remove or demote duplicated UI sections only after multi-scenario tests prove the Timeline handles the information clearly.

## Verification

- A SEO keyword task chain shows Task Brief, Execution Report, any decision request, decision resolution, and stage change without SEO-specific rendering rules.
- A pricing test case uses the same item types and layout.
- An MVP definition test case uses the same item types and layout.
- A launch or customer research test case uses the same item types and layout.
- CEO Pending excludes ordinary Task Briefs and Execution Reports.
- Timeline includes ordinary task completions as readable Execution Reports.
- No Timeline item exposes raw execution logs, workspace paths, proof capture details, or diagnostic-only events.
