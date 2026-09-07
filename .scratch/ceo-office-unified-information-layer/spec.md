Status: ready-for-agent

# CEO Office Unified Information Layer Spec

## Problem Statement

The CEO Office currently reads like several disconnected surfaces: Outcomes, CEO Pending, Attention Rollups, Human Actions, Wait States, review details, and final reports each present their own interpretation of company state. Even after prior improvements, department task results can still feel redundant and hard to understand because the user has to infer what the task was for, what decision or approval is needed, what the department concluded, how the work affects the Founder Vision, and what should happen next.

The immediate SEO keyword example exposes the problem, but the fix must not be SEO-specific. When the user switches to pricing, MVP definition, customer research, launch planning, or another test case, CEO Office should still show the same macro flow: Task Brief, any CEO action item, Execution Report, and higher-level stage changes in chronological order.

## Solution

Introduce a unified CEO Office Item projection. CEO Office should consume one shared macro business timeline instead of each UI section reconstructing CEO-facing meaning from raw tasks, artifacts, events, and queues.

The primary seam is:

```ts
projectCeoOfficeItems(companyState) -> CEOOfficeItem[]
```

The projection should turn existing durable company facts into stable, ordered CEO Office Items. It should not add a persisted `ceo_office_items` table in the first implementation. The CEO Office first screen should lead with company state, then pending actions, then a global CEO Office Timeline. The Timeline should show only macro business nodes: Task Briefs, action-bearing items, Execution Reports, Objective Stage Changes, Decision Resolutions, Human Actions, Wait States, Blocked Issues, and Final Founder Reports.

Every task should have a Task Brief before execution and an Execution Report after completion. Execution-time action items are optional and appear only when the task actually needs CEO or founder movement. Ordinary task completion must appear in the CEO Office Timeline as a readable Execution Report, but must not enter CEO Pending unless it requires action.

## User Stories

1. As a founder, I want CEO Office to show company state before queues, so that I understand the business situation before reacting to individual items.
2. As a founder, I want CEO Office to show only real action items in CEO Pending, so that I do not treat every completed task as something I must approve.
3. As a founder, I want every task to appear in a chronological CEO Office Timeline, so that I can understand the macro flow of work.
4. As a founder, I want each task to have a Task Brief before execution, so that I know what the task is trying to accomplish.
5. As a founder, I want a Task Brief to explain purpose, expected output, vision or objective link, dependencies, and likely next step, so that I can understand why the task exists.
6. As a founder, I want task execution details kept out of the CEO Office Timeline, so that I am not forced to read run logs or diagnostics to understand progress.
7. As a founder, I want task start, retry, proof capture, workspace path, raw logs, and diagnostics to stay in task detail or diagnostic surfaces, so that CEO Office remains a business control surface.
8. As a founder, I want every completed task to produce an Execution Report, so that I know what was completed.
9. As a founder, I want an Execution Report to show the execution conclusion, so that I can quickly understand the department's result.
10. As a founder, I want an Execution Report to show the meaning for the Founder Vision or objective, so that I can connect task output to strategy.
11. As a founder, I want an Execution Report to show remaining gaps, so that I understand what is still unproven or unfinished.
12. As a founder, I want an Execution Report to include a recommendation, so that I understand the proposed next move.
13. As a founder, I want evidence and validation to be expandable or secondary, so that I can inspect proof without it dominating the default read.
14. As a founder, I want a decision request to appear after the report that justifies it, so that I understand the choice before being asked to make it.
15. As a founder, I want a task that completes with both a report and a decision to show the Execution Report first, so that the decision has context.
16. As a founder, I want pending decisions to appear both in the top pending summary and in the Timeline, so that I have a shortcut for action and a chronological history.
17. As a founder, I want resolving a decision to update the original pending item, so that the current state is clear.
18. As a founder, I want resolving a decision to append a Decision Resolution to the Timeline, so that the historical sequence remains clear.
19. As a founder, I want Human Actions to appear as action-bearing CEO Office Items, so that external human work is visible in the same model.
20. As a founder, I want Wait States to appear as their own CEO Office Items, so that waiting on indexing, responses, approvals, or other external delays is not mistaken for failure.
21. As a founder, I want Blocked Issues to appear in the same macro layer, so that failures, retry exhaustion, missing deliverables, and replanning needs are visible without searching task internals.
22. As a founder, I want Objective Stage Changes to appear in the Timeline as milestone rows, so that I can see when a goal-level phase changes.
23. As a founder, I want Objective Stage Changes to be objective-level items rather than department task reports, so that I do not confuse a milestone with one department's output.
24. As a founder, I want Final Founder Reports to appear as company-level CEO Office Items, so that company-level summaries fit the same information architecture.
25. As a founder, I want future or not-yet-started work outside the Timeline, so that the Timeline stays a history of what has happened.
26. As a founder, I want upcoming work to remain visible in execution status or task relationship views, so that roadmap-like information is not lost.
27. As a founder, I want CEO Office Items to be sorted globally by occurrence time, so that task brief, action item, execution report, and stage change order is easy to follow across departments.
28. As a founder, I want multi-department work to share the same Timeline, so that I see the company sequence rather than isolated department feeds.
29. As a founder, I want CEO Office to work for SEO keyword research without SEO-specific UI rules, so that the current test case is covered by the abstraction.
30. As a founder, I want CEO Office to work for pricing with the same item types and layout, so that the abstraction survives a different business topic.
31. As a founder, I want CEO Office to work for MVP definition with the same item types and layout, so that product planning does not need bespoke cards.
32. As a founder, I want CEO Office to work for launch planning or customer research with the same item types and layout, so that all playbook-like tasks remain consistent.
33. As a founder, I want old task outcome data to remain readable, so that existing companies do not become blank after the new projection ships.
34. As a founder, I want new Execution Reports to be structured, so that CEO Office can split conclusion, vision impact, remaining gap, and recommendation reliably.
35. As a founder, I want older Task Outcome Summary prose to be used as fallback, so that migration does not require re-running old tasks.
36. As a founder, I want Task Briefs to use department assessment when available, so that the brief reflects the department's understanding.
37. As a founder, I want Task Briefs to fall back to task definitions when assessment details are unavailable, so that every task can still be introduced.
38. As a developer, I want a single projection seam for CEO Office Items, so that tests can lock down the business behavior once.
39. As a developer, I want stable CEO Office Item IDs derived from source facts, so that repeated company state reads do not duplicate Timeline rows.
40. As a developer, I want CEO Pending to derive from action-bearing CEO Office Items, so that pending and Timeline cannot drift.
41. As a developer, I want CEO decision surfaces to consume the same projection, so that decision cards and timeline items use the same source meaning.
42. As a developer, I want the projection to use existing durable facts first, so that we avoid a duplicated `ceo_office_items` write model.
43. As a developer, I want a documented future point for a persisted table, so that later read receipts or user-authored CEO Office Items have a clear path without polluting v1.
44. As a developer, I want tests that use several non-SEO scenarios, so that SEO-specific patches are caught.
45. As a developer, I want UI tests to assert generic rendering by item type, so that artifact subtype or task-title special cases do not creep in.
46. As a developer, I want existing Outcomes, Pending, Attention, Human Action, Wait State, and Final Founder Report sections preserved in the first pass, so that the migration can be incremental.
47. As a developer, I want duplicated UI sections consolidated only after the Timeline proves coverage, so that we do not remove useful surfaces prematurely.
48. As a department operator, I want completed work to become an Execution Report rather than raw proof text, so that CEO Office can read the business conclusion.
49. As a department operator, I want requests for CEO movement to remain distinct from execution reports, so that reports are not mistaken for approval prompts.
50. As a maintainer, I want ADR 0019 respected by future changes, so that routine completions are not hidden and pending queues are not flooded again.

## Implementation Decisions

- Add a shared CEO Office Item contract that can represent Task Briefs, Execution Reports, decision requests, approval requests, Decision Resolutions, Human Actions, Wait States, Blocked Issues, stage changes, and final reports.
- Treat CEO Office Item as a projected model in the first implementation, not as a new persisted table.
- Add one primary projection seam: `projectCeoOfficeItems(companyState) -> CEOOfficeItem[]`.
- The projection input should be broad company state, including tasks, task dependencies, task completion events, business artifacts, founder decisions, CEO review decisions, human actions, wait states, vision gaps, CEO attention rollups, final founder reports, departments, objectives, and key results.
- The projection should expose stable IDs derived from source facts.
- The projection should sort items by occurrence time and apply deterministic tie-breaking when multiple items share the same source event time.
- The projection should produce Task Brief items from task definition data, dependencies, objective/key result context, and department assessment/progress data when available.
- Department assessment data should be preferred for Task Briefs when it exists because it represents the department's confirmed understanding.
- Task definition data should be a fallback for Task Briefs so every task can have a macro introduction.
- The future direction is for department assessment to produce structured Task Brief fields.
- The projection should produce Execution Report items from Task Completion Events and associated Business Artifacts.
- New Execution Reports should be structured around conclusion, vision impact, remaining gap, and recommendation.
- Existing Task Outcome Summary prose should remain a compatibility fallback.
- Compatibility fallback should not weaken the new contract for future task outputs.
- Ordinary Execution Reports should appear in the Timeline but not in CEO Pending.
- Only action-bearing CEO Office Items should appear in CEO Pending.
- Action-bearing items include unresolved decision requests, approval requests, unresolved Human Actions, active critical Blocked Issues, and other items that require CEO or founder movement.
- Wait States should be represented as CEO Office Items but should not be treated as failures.
- Stage changes should be represented as objective-level CEO Office Items, even when triggered by task completion.
- Final Founder Reports should be represented as company-level CEO Office Items.
- If a Task Completion Event produces both an Execution Report and a decision request, the Execution Report should sort before the decision request.
- Resolving a decision should both update the pending source item and project a Decision Resolution item into the Timeline.
- CEO Office first screen should present company state summary, CEO pending summary, and CEO Office Timeline in that order.
- Existing CEO Office sections should remain during the first implementation and can be consolidated after multi-scenario coverage is proven.
- The Dashboard should render CEO Office Items generically by item type and must not branch on SEO-specific labels, task titles, or artifact subtypes.
- The API should include projected CEO Office Items in company state while keeping existing state fields for compatibility.
- A persisted `ceo_office_items` table is explicitly out of the first implementation.
- A persisted table may be reconsidered if future features need user-authored standalone items, durable read or acknowledgement state, cross-session manual edits, or retention independent of source facts.

## Testing Decisions

- The highest-value tests should target the projection seam. They should assert external CEO Office behavior from company state input to CEO Office Item output, not internal helper structure.
- Projection tests should cover at least three non-SEO scenarios, such as pricing, MVP definition, and launch planning or customer research.
- Projection tests should also cover the SEO scenario as an example, but the SEO case must not be the only fixture.
- Projection tests should assert that every task with sufficient source facts gets a Task Brief and an Execution Report.
- Projection tests should assert that ordinary Task Briefs and Execution Reports do not enter CEO Pending.
- Projection tests should assert that action-bearing items do enter CEO Pending.
- Projection tests should assert that Timeline ordering is global and chronological.
- Projection tests should assert the ordering of Execution Report before decision request for the same completion event.
- Projection tests should assert that a Decision Resolution appears after a decision is resolved.
- Projection tests should assert that Objective Stage Changes are objective-level items and not task-level reports.
- Projection tests should assert stable IDs across repeated projection calls.
- Projection tests should assert that low-level execution events are excluded from Timeline output.
- API tests should assert that company state includes CEO Office Items and preserves existing fields used by older UI sections.
- Dashboard tests should assert that CEO Office shows company state, pending summary, and Timeline in order.
- Dashboard tests should assert that the Timeline renders generic CEO Office Item types without special-case SEO UI.
- Dashboard tests should use varied business fixtures so case-specific copy or layout assumptions fail visibly.
- Existing tests around Founder Decisions, CEO Pending, Outcomes, Final Founder Reports, and Attention Rollups are prior art and should guide fixture construction.
- Existing dashboard tests that render CEO Pending, Outcomes, Founder Decisions, and Final Founder Reports are prior art for UI expectations.
- Existing server tests around CEO Attention projection, Founder Decision projection, automatic acceptance, and task completion events are prior art for projection behavior.
- Structured Execution Report tests should verify that new structured fields render separately and that old Task Outcome Summary prose still appears as fallback.

## Out of Scope

- Building SEO-specific CEO Office cards, SEO-specific copy, or SEO-specific artifact subtype handling.
- Replacing all existing CEO Office sections in the first pass.
- Adding a persisted `ceo_office_items` table in the first pass.
- Showing task execution logs, raw agent output, workspace paths, proof capture events, retry events, or diagnostics in the CEO Office Timeline.
- Building a future roadmap inside the Timeline.
- Requiring all old completed tasks to be backfilled with structured Execution Reports.
- Re-running old agents to synthesize structured summaries.
- Redesigning the entire dashboard visual system.
- Changing the meaning of Founder Decision, CEO Review Decision, Human Action, Wait State, Objective Stage Change, or Final Founder Report beyond projecting them into the unified layer.
- Implementing durable read receipts, acknowledgements, user-authored CEO Office Items, or manual timeline editing.

## Further Notes

This spec implements ADR 0019 and refines the earlier ADR 0017 language. Routine task completions should not create high-priority interruption and should not enter CEO Pending, but they must not disappear. They should become readable Execution Reports in the CEO Office Timeline.

The abstraction, not the SEO example, is the unit of design. A successful implementation should survive swapping the business scenario without adding new UI branches for each task topic.

The intended implementation order is projection contract first, API state second, Dashboard Timeline third, structured output contract fourth, and UI consolidation last.
