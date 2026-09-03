Status: ready-for-agent

# CEO Office Surfaces Business Outcomes, Not Review Mechanics

Governing decision: `docs/adr/0017-ceo-office-surfaces-business-outcomes.md`. Execution plan: `docs/ceo-office-business-outcomes-plan.md`. Glossary terms: `CONTEXT.md` (**Automatic Acceptance**, **Founder Decision**, **Strategic Decision Kind**, **Task Outcome Summary**, **Founder Approval**, **CEO Decision**, **Task Completion Event**, **CEO Attention Item**, **Next Step Item**).

## Problem Statement

The founder opens CEO Office and finds every completed department task waiting in a review queue. To clear one, they open a panel that leads with a proof file name, a workspace path, an artifact kind/role/subtype triple, and a `valid / unreviewed` status line, then a "通过，标记完成" button. This is plumbing. The founder does not want to certify that a task ran correctly — the runtime already validated the artifact. What the founder actually needs from a finished task is two things: the conclusion it reached, and any choice it leaves open that is theirs to make (for example, a research task returns several viable options and the founder must pick the direction). Today the conclusion is never shown — only the artifact's classification metadata is — and the choice is buried inside an approve/return review gate instead of being presented as a decision.

Underneath, the mechanism meant to remove this friction does not work. **Automatic Acceptance** exists in the runtime but requires an opt-in marker in the artifact payload that no agent prompt asks for, so it never fires. Its secondary `riskLevel === "low"` gate is also dead: in real companies the CEO Agent labels every substantive task `medium`. Every valid deliverable therefore falls through to a manual CEO Review it should never have needed.

## Solution

CEO Office becomes a company-state surface. Internal deliverables are accepted automatically by default, with no CEO click. The only thing a completed task puts in front of the founder is a **Founder Decision**: a pick among viable options for a strategic business decision whose first value is the founder's to set, and which the runtime and CEO Agent must not resolve on their own. Resolving that decision *is* the acceptance of the deliverable — there is no separate approve step.

For every completed task the founder reads a **Task Outcome Summary** — the conclusion, what it means for the objective, what gap remains — not the proof file and validation status behind it. A new Outcomes view in CEO Office lists recent outcomes grouped by objective and pins unresolved Founder Decisions at the top as the actionable items. The Review, Decision, and Blocked queues stay, but move to a secondary position. Manual CEO review shrinks to a single safety-net case: a deliverable whose text trips a deterministic external-or-sensitive risk-pattern scan.

The founder-owned choice is scoped by a fixed, playbook-neutral **Strategic Decision Kind** enum (target market, product direction, MVP type, pricing model, launch target), declared by the completing agent in an `open_decisions` block. This deliberately avoids the unbuilt schema-registry / inherited-decision-field / Direction Drift model.

## User Stories

1. As a founder, I want valid internal deliverables to be accepted without my involvement, so that CEO Office stops being a queue of rubber-stamp approvals.
2. As a founder, I want acceptance to happen automatically even for tasks the CEO Agent labelled `medium`, so that a cautious risk label does not force routine work through me.
3. As a founder, I do not want to certify that a task executed correctly, so that my attention is spent on business judgement, not process.
4. As a founder, when a completed task leaves a strategic choice open, I want that choice presented to me as a decision with options, so that I direct the company instead of approving deliverables.
5. As a founder, I want each option in a Founder Decision to show its trade-offs and the agent's recommendation, so that I can decide quickly and with context.
6. As a founder, I want picking an option to be the acceptance of that deliverable, so that there is no redundant "now approve it" step after I have already decided.
7. As a founder, when a task surfaces more than one strategic choice, I want the deliverable to wait until I have resolved all of them, so that downstream work never starts from a half-made decision.
8. As a founder, I want to reject every option on a decision and send the task back to the department with a note, so that I can ask for better options without the runtime picking one for me.
9. As a founder, I want an unresolved Founder Decision to wait indefinitely with no timeout and no default selection, so that the runtime never resolves a strategic choice on my behalf.
10. As a founder, I want to see which downstream tasks are blocked specifically because a decision of mine is outstanding, so that I understand the cost of not deciding.
11. As a founder, I want an unresolved Founder Decision to surface prominently in CEO Office, so that I do not have to go looking for what is waiting on me.
12. As a founder, I want each completed task to show the conclusion it reached in plain language, so that I understand the result without opening the artifact.
13. As a founder, I want each completed task to explain what its conclusion means for the objective it serves, so that task activity stays connected to the company plan.
14. As a founder, I want each completed task to state what gap still remains toward the vision, so that I do not mistake task completion for business success.
15. As a founder, I want the CEO Office home to lead with recent outcomes and pending decisions, so that the first screen answers "what happened and what needs me".
16. As a founder, I want outcomes grouped by objective, so that I read the company as progress toward goals rather than a list of tasks.
17. As a founder, I want proof files, workspace paths, artifact classification, and validation status kept out of the primary view, so that CEO Office reads as business situation, not database state.
18. As a founder, I want that evidence still available in a secondary, collapsed section, so that I can inspect it when I actually need to.
19. As a founder, I want the Review, Decision, and Blocked queues to remain reachable, so that risky or exceptional work still has a home.
20. As a founder, I want a deliverable whose text involves public launch, spending, credentials, account permissions, or other external or sensitive action to still require my manual review, so that automation does not overstep.
21. As a founder, I want the risk scan not to flag ordinary product and research language, so that the safety net does not recreate the queue it was meant to shrink.
22. As a founder, I want automatically accepted work to remain visible in the company state and dependency chains, so that automation does not reduce accountability.
23. As a department lead, I want my low-risk deliverables to flow downstream automatically once valid, so that routine handoffs do not wait on a CEO click.
24. As a department lead, I want a returned Founder Decision to come back with the founder's note, so that I know what better options to produce.
25. As an agent completing a task, I want to declare a strategic choice I am making as an `open_decisions` entry, so that the runtime routes it to the founder instead of letting my pick stand as direction.
26. As an agent completing a task, I want to produce a Task Outcome Summary as part of my deliverable, so that the founder sees a conclusion rather than my raw output.
27. As an agent completing a task, I want a choice I make that is not a Strategic Decision Kind to remain my own call, so that tactical decisions do not spam the founder.
28. As a downstream department, I want the founder's resolved choice carried in my handoff context, so that I build on the decided direction.
29. As a CEO Agent, I want automatically accepted work and resolved Founder Decisions to leave durable Task Completion Events with acceptance provenance, so that later planning reasons from real accepted business states.
30. As a CEO Agent, I want Founder Decisions to be distinct from CEO Decisions in company state, so that I do not treat a founder-reserved choice as something I can route or resolve.
31. As a developer, I want manual CEO approval, Automatic Acceptance, and Founder Decision resolution to share one business acceptance path, so that Task Completion Event creation, Next Step Routing, dependency cascade, key-result updates, and scheduler wake behave identically.
32. As a developer, I want `riskLevel` removed from the acceptance decision, so that nobody re-adds a check that depends on an unreliable label.
33. As a developer, I want the founder-owned choice scoped by a fixed core enum rather than a per-task-type registry, so that the feature does not depend on the unbuilt schema-registry and Direction Drift model.
34. As a developer, I want new persisted vocabulary (`founder_decision` Next Step Item type, `founder_decision` acceptance provenance, `StrategicDecisionKind`) added to core and its zod schemas, so that state stays validated.
35. As an operator upgrading an existing company, I want tasks currently sitting in `review` to be re-evaluated once against the new acceptance rules, so that I am not left with a queue of items the new model would have accepted.
36. As an operator, I want that one-time reconciliation to be idempotent and to leave risk-pattern-caught tasks in the manual panel, so that re-running it is safe and nothing sensitive is auto-accepted.
37. As an operator, I want already-`complete` tasks left untouched with no synthesized summary, so that the upgrade does not fabricate history.
38. As a founder, I want a completed task with no strategic choice and no risk-pattern hit to never appear as something I must action, so that silence is the default for routine work.

## Implementation Decisions

### Acceptance model

- **Remove the opt-in gate.** `evaluateAutomaticAcceptance` no longer checks for an `autoAccept` / `acceptance` payload marker, and no longer early-returns on `riskLevel !== "low"`. `riskLevel` is demoted to a planning hint everywhere in the acceptance path.
- **Deterministic acceptance conditions.** A completed deliverable is auto-accepted when: the current Business Artifact is `deliverable` or `final_report`, `validationStatus = valid`, `isCurrent`, `reviewStatus = unreviewed`; its text does not match the external-or-sensitive risk patterns; no Founder Approval action is involved; and it carries no unresolved Founder Decision.
- **Tighten the risk patterns.** The scan currently used by `evaluateAutomaticAcceptance` must be narrowed from broad single-word patterns (which match ordinary product language) to precise phrases for public launch, deployment to production, custom/production domains, Search Console/sitemap submission, connecting ad or affiliate accounts, spending/billing/subscriptions, legal or compliance exposure, user or personal data exposure, credentials/API keys/secrets, account permissions or OAuth grants, and irreversible external actions. A hit routes the deliverable to manual CEO review; it is the only remaining path into that queue.
- **Shared acceptance path.** Manual CEO approval, Automatic Acceptance, and Founder Decision resolution all run through the existing business acceptance seam. That seam owns accepted-status change, task completion, Task Completion Event creation, Next Step Routing, dependency cascade, key-result updates, and scheduler wake. No behaviour there changes except the added `founder_decision` provenance value.

### Founder Decision

- **New Next Step Item type.** Add `founder_decision` to `NextStepItemType` and its zod schema. The source task's Business Artifact stays kind `deliverable`; the decision rides on the Task Completion Event as a Next Step Item and is projected into a first-class object.
- **New projected object.** A `FounderDecision` projection mirrors the `HumanAction` shape: identity, source Task Completion Event, task, owning department, `decisionKind`, ordered `options` (each with a display label and its trade-offs, one flagged as the recommendation), `rationale`, `status` (`pending` / `resolved` / `returned`), resolved option, resolved timestamp, blocked task ids. Produced by the CEO-attention projection alongside Human Actions, Wait States, and Vision Gaps.
- **Strategic Decision Kind enum.** Add `StrategicDecisionKind` to `packages/core` with a zod schema. Seed values: `target_market`, `product_direction`, `mvp_type`, `pricing_model`, `launch_target`. Extended only by code change. Playbook-neutral — no use-case names.
- **Declaration contract.** The completing agent writes an `open_decisions` array into `.auto-crop/business-artifact.json`. Each entry: `decisionKind`, `options` (more than one, each with label and trade-offs), `recommendation` (which option), `rationale`. Business Artifact parsing keeps entries whose `decisionKind` is in the enum and that carry more than one option; entries with an unknown `decisionKind` are dropped silently; a malformed entry on a known `decisionKind` is a structural validation failure like any other required-field failure.
- **Agent prompt.** The task prompt gains an instruction block telling the agent to declare, in `open_decisions`, any choice it is making on a Strategic Decision Kind, and that such a choice is the founder's to make, not the agent's.
- **Acceptance gating.** When a completed deliverable declares one or more kept `open_decisions`, it is not auto-accepted and is not sent to manual review. The runtime emits the Task Completion Event (carrying the `founder_decision` Next Step Items and the Task Outcome Summary) and stops. Downstream dependency readiness continues to block on the non-accepted upstream.
- **Resolution is acceptance.** A new API accepts either a pick (`founderDecisionId`, chosen option) or a return (`founderDecisionId`, note, structured return reason). On a pick: record the resolution; write the chosen value into the accepted artifact's payload under its `decisionKind`; when every Founder Decision on the task is resolved, run the shared acceptance seam with `acceptanceProvenance = founder_decision`; the resolved values flow downstream through the normal Task Completion Event and cascade path and into the handoff context. On a return: send the task back to the department through the existing CEO-review return path, discard recorded picks for that task, write a department progress event. A resolution for a task no longer awaiting the decision is rejected with `409`.
- **New acceptance provenance.** Add `founder_decision` to `TaskAcceptanceProvenance` (and a dedicated zod schema if one is introduced). Existing values `manual_ceo_review` and `automatic_acceptance` are unchanged.
- **Lifecycle.** An unresolved Founder Decision has no timeout, no auto-resolution, no default selection. It creates a CEO Attention Item — add `founder_decision` as a CEO Attention Rollup reason so it appears both pinned in the Outcomes view and grouped in Attention Rollups. A resolved Founder Decision creates none.
- **Waiting-on-decision display.** Downstream tasks blocked because an upstream deliverable has an unresolved Founder Decision show a derived "waiting on decision" state in the CEO Task Dependency Graph and dependency-readiness output. This is computed, not a new persisted `Task` status.
- **Founder Decision vs Founder Approval.** Founder Decision is the first assignment of a strategic value. A later change to an already-accepted value is Founder Approval territory and is not built here; the existing (largely unimplemented) Founder Approval surface is untouched.

### Information presentation

- **Task Outcome Summary.** Add `outcomeSummaryText` (localized-text shaped, nullable) to `TaskCompletionEvent` — core type, zod schema, persistence column and migration, repository mapping, and the company-state serializer. Distinct from the existing Task Execution Summary (failure facts).
- **Summary contract.** The completing agent produces a summary answering: the conclusion reached; what it means for the objective or vision it serves; what gap remains (in prose); and — only when there is a Founder Decision — the options with trade-offs and the recommendation. The first three are required on `deliverable` and `final_report` artifacts; a missing summary is a structural validation failure. The runtime does not judge the summary's meaning.
- **Outcomes view.** CEO Office gains a view listing recent Task Completion Events grouped by objective, each rendering its Task Outcome Summary and dependency impact in business language, with unresolved Founder Decisions pinned at the top carrying their options, recommendation, and pick / return controls. The dashboard must start holding `taskCompletionEvents` in app state (currently fetched but unused) and pass them through.
- **Queue demotion.** The Review, Decision, and Blocked queues remain functional but move below the Outcomes overview. They are not removed.
- **Review detail restructure.** The CEO task-review detail panel leads with the Task Outcome Summary conclusion. The current department-submission content (proof summary, proof type and URI, artifact kind/role/subtype, validation and review status) moves into a collapsed "evidence and validation" section. The pending-review queue copy is updated to reflect that it now contains only risk-pattern-caught deliverables.
- **Company state.** The company-state response serializes the projected `founderDecisions` and the `outcomeSummaryText` on Task Completion Events. The agent-activity log gains readable cases for `automatic_acceptance`, `founder_decision`, and `ceo_review_decision` events instead of falling through to a generic status label.

### Migration

- No data backfill. No Task Outcome Summary or Task Completion Event is synthesized for tasks that are already `complete`.
- A one-time reconciliation, safe to run once and idempotent, re-evaluates every task currently in `review` against the deterministic acceptance conditions: qualifying tasks are accepted through the shared seam with provenance `automatic_acceptance` and no `outcomeSummaryText`; the rest stay in `review` for the restructured manual panel.
- Existing `blocked` tasks follow their normal paths. The known stuck company is not migrated (ADR 0015 precedent).

## Testing Decisions

A good test here asserts externally observable outcomes — accepted artifact status, task status, persisted Task Completion Event and its fields, projected `founderDecisions`, dependency cascade results, company-state serialization, API status codes, and rendered dashboard state — never private helper names, rollup sort order beyond the user-visible priority rule, or graph layout. Prefer feeding a Business Artifact through the real acceptance path over unit-testing the `open_decisions` parser or the projection in isolation.

### Seam 1 — Task business acceptance (`apps/server/src/runtime`, business acceptance + `automaticAcceptance` + `scheduler.test.ts`)

Prior art: the existing business-acceptance tests from the task-completion-events work (issues 01 and 07), and `scheduler.test.ts` dispatch/acceptance cases.

- A valid low-stakes deliverable with no payload marker and `riskLevel` other than `low` is automatically accepted, producing an accepted artifact, a complete task, a Task Completion Event, routed Next Step Items, and a dependency cascade.
- The tightened risk scan still routes a deliverable whose text involves public launch, spending, credentials, account permissions, or an irreversible external action to manual review.
- Regression fixtures: ordinary product-brief and research-report text does not trip the risk scan.
- A deliverable declaring an `open_decisions` entry on a known `decisionKind` is not auto-accepted and not sent to manual review; its Task Completion Event carries a `founder_decision` Next Step Item and an `outcomeSummaryText`.
- An `open_decisions` entry on an unknown `decisionKind` is dropped; the deliverable auto-accepts.
- A malformed `open_decisions` entry on a known `decisionKind` fails structural validation.
- Resolving the only Founder Decision on a task writes the chosen value into the artifact payload and runs the shared acceptance seam with provenance `founder_decision`, then cascades downstream.
- A task with two Founder Decisions is accepted only after both are resolved; each pick is recorded when made.
- Returning a Founder Decision sends the task back to the department and discards recorded picks.
- Blocked and needs-replan outcomes still create Task Completion Events without unlocking ordinary downstream dependencies.
- The migration reconciliation accepts a qualifying `review` task exactly once, is idempotent on re-run, and leaves a risk-pattern-caught `review` task in place.
- Manual CEO approval of a risk-pattern-caught deliverable still works.

### Seam 2 — Company State Snapshot + CEO attention projection (`apps/server/src/api/routes.test.ts`, `ceoAttention` tests)

Prior art: existing state-endpoint route tests and CEO attention-rollup tests.

- The company-state response serializes Task Completion Events with `outcomeSummaryText` and serializes projected `founderDecisions` with their options, recommendation, status, and blocked task ids.
- An unresolved Founder Decision appears as a `founder_decision` CEO Attention Rollup reason, preserving owning department and affected tasks; a resolved one does not.
- An ordinary auto-accepted task completion is recorded without becoming a CEO Attention Item.
- `POST` to the founder-decisions endpoint: a pick resolves and (when last) accepts; a return sends back and discards; a stale resolution returns `409`; a return without a reason is a validation error.
- Dependency readiness reports "waiting on decision" when the upstream block is an unresolved Founder Decision, and ordinary "waiting for dependency" otherwise.

### Seam 3 — Dashboard CEO Workspace (`apps/dashboard/src/App.test.tsx`, `DepartmentWorkspace` tests)

Prior art: existing CEO Pending, CEO Task Dependency Graph, and App-flow dashboard tests.

- The Outcomes view renders Task Outcome Summaries grouped by objective and pins unresolved Founder Decisions with pick and return controls that call the founder-decisions endpoint; picking closes the item and reflects acceptance.
- The review detail panel leads with the Task Outcome Summary; proof type/URI, artifact classification, and validation/review status are in a collapsed section, not the primary view.
- The CEO Task Dependency Graph shows "waiting on decision" for a downstream node blocked on an unresolved Founder Decision.
- The Review, Decision, and Blocked queues remain reachable after the Outcomes overview is added.
- Approve and return controls stay in the review detail flow, not duplicated in graph nodes.

### Seam 4 — Core schema (`packages/core/src/schemas.test.ts`)

- The new `founder_decision` `NextStepItemType`, the new `founder_decision` `TaskAcceptanceProvenance`, and each `StrategicDecisionKind` value parse through their zod schemas.

## Out of Scope

- The schema registry (`task_type` → expected artifact kind/role, payload schema, inherited decision fields) from `docs/accepted-business-artifact-gated-dependencies-plan.md` / ADR 0011.
- Direction Drift detection. `invalid_drift`, `invalid_blocker`, and `stale` remain defined and never produced.
- Any revision of the CEO Agent's `riskLevel` assignment or its planning prompt.
- Founder Approval machinery — the central trigger list, wiring the `approvalRequired` callback, and the "later change to an accepted value" flow.
- Splitting `tasks.status` into execution / review / business columns.
- A full CEO Office home redesign. The Outcomes view is an addition; the existing queues stay.
- Data backfill of Task Outcome Summaries or Task Completion Events for already-`complete` tasks.
- An AI semantic judge for Task Outcome Summaries or Business Artifacts.
- Runtime configuration of the Strategic Decision Kind set.
- Letting the founder mark an auto-accepted outcome for follow-up or request rework after the fact (noted as follow-on).
- Migrating the known stuck company.

## Further Notes

This spec continues the arc of ADR 0007 (CEO Office owns review decisions) and ADR 0014 (review is not the default path). ADR 0014's intent was already correct; the implementation never left the review-gated model because Automatic Acceptance shipped behind an opt-in nothing opts into and a `riskLevel` gate the CEO Agent's own labelling defeats. This spec makes the non-default real and defines what replaces it.

The load-bearing discipline is unchanged from ADR 0014: Business Artifact validation stays the semantic gate. Automatic Acceptance removes low-value CEO clicks; it does not weaken the checks that catch invalid artifacts, blockers, stale proof, or sensitive external action. The tightened risk-pattern scan is the safety net for the last category, and Founder Decision is the explicit surface for strategic choices the runtime must never make itself.

Founder Decision is deliberately scoped by a fixed core enum instead of the unbuilt inherited-decision-field model. When the schema registry and Direction Drift detection are eventually built, Strategic Decision Kind should be re-expressed against declared inherited decision fields; until then the enum is the whole contract.

The SEO-keyword scenario from the existing playbook remains a useful proving ground — a research task returning several viable options, one recommended, with the founder's pick becoming the accepted direction that Product consumes — but nothing in the model is specific to it.
