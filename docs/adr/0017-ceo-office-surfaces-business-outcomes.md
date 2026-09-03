# CEO Office Surfaces Business Outcomes, Not Review Mechanics

Auto-Crop will stop routing every valid deliverable through a manual CEO Review gate. Internal deliverables are accepted automatically by default; the only thing a completed task puts in front of the founder is a **Founder Decision** — a choice among viable options for a strategic decision the runtime must not make on its own. What the founder reads about a completed task is its **Task Outcome Summary** — the conclusion and what it means for the objective — not the proof file, workspace path, and validation status that back it.

## Considered Options

- **Keep CEO Review as the default gate for every deliverable:** preserves the earlier safety model, but makes routine internal handoffs wait on a manual click even when the runtime can validate the artifact and the risk is low. This is the state ADR 0014 already decided to move away from; the current implementation never actually left it.
- **Automatic Acceptance as an opt-in the agent marks:** the shipped `automaticAcceptance.ts` requires an `autoAccept` / `acceptance` marker in the artifact payload. No prompt tells agents to write it, so the marker is never present and Automatic Acceptance never fires. Opt-in that nothing opts into is a disabled feature.
- **Gate acceptance on the CEO Agent's `riskLevel`:** in real data the CEO Agent labels every substantive task `medium`, so a `low`-only gate keeps Automatic Acceptance dead regardless of the marker. `riskLevel` is not a trustworthy acceptance signal.
- **Notify CEO Office for every completed task:** rejected in ADR 0014 as a noisy message stream that keeps the founder in a low-leverage approval posture. Still rejected.
- **Build the schema registry and Direction Drift detection first, then define Founder Decision as a choice over an "inherited decision field":** the registry, the per-task-type inherited-decision-field declarations, and drift detection are all specified in `docs/accepted-business-artifact-gated-dependencies-plan.md` / ADR 0011 but unbuilt (`invalid_drift`, `invalid_blocker`, `stale` are defined and never produced). Building that foundation is a larger effort than this change and was explicitly scoped out.
- **Deterministic Automatic Acceptance, plus a founder-owned Founder Decision scoped by a fixed enum:** accept internal deliverables on deterministic checks; surface the one thing that is genuinely the founder's call as a first-class decision, scoped without needing the unbuilt registry.

## Decision

Adopt deterministic Automatic Acceptance plus Founder Decision. One decision, implemented in two sequenced phases.

### Phase A — Acceptance

A completed deliverable is accepted automatically, with no CEO click, when all of the following hold:

- the current Business Artifact is `deliverable` or `final_report`, `validationStatus = valid`, `isCurrent`, and `reviewStatus = unreviewed`;
- its text does not match the deterministic external-or-sensitive risk patterns (`FORBIDDEN_RISK_PATTERNS`, tightened from the current broad list so patterns like `\baccount\b` and `\bpermission\b` do not fire on ordinary product language);
- no Founder Approval action is involved;
- it carries no unresolved Founder Decision.

The `isMarkedForInternalAutomaticAcceptance` opt-in gate is removed. Task `riskLevel` is demoted to a planning hint and is no longer an acceptance gate; the CEO Agent's risk-labelling is not revised in this change. Automatic Acceptance continues to run through the existing `businessAcceptance` seam, so Task Completion Event creation, Next Step Routing, dependency cascade, key-result updates, and scheduler wake are unchanged.

### Founder Decision

A **Founder Decision** is a choice reserved for the human founder that a completed task's output surfaces. It is distinct from a **CEO Decision** (agent-level routing) and from **Founder Approval** (yes/no consent for an already-proposed high-impact action). A Founder Decision is the *first* assignment of a value; a later change to an accepted value is Founder Approval territory, and that half is not built here.

- **Scope.** A Founder Decision is an agent-declared open choice whose `decisionKind` is one of a fixed, playbook-neutral **Strategic Decision Kind** enum in `packages/core`. Seed set: target market/segment, product direction/category, MVP type, pricing/revenue model, launch/distribution target. Extended by code change, not runtime config. A choice whose `decisionKind` is outside the enum is the agent's own call and is ignored by the runtime.
- **Declaration.** The completing agent writes `open_decisions: [{ decisionKind, options, recommendation, rationale }]` into `.auto-crop/business-artifact.json`. The runtime keeps entries whose `decisionKind` is in the enum and that carry more than one option; each becomes a `founder_decision` **Next Step Item** (new `NextStepItemType`, added to the core type and its zod schema) and is projected into a first-class `FounderDecision` object, mirroring the `human_action` → `HumanAction` projection in `ceoAttention.ts`. The source task's artifact stays `deliverable`.
- **Resolution is acceptance.** A deliverable carrying an unresolved Founder Decision does not auto-accept. The founder picking an option *is* the acceptance of that deliverable — there is no separate approve step. When a task surfaces more than one Founder Decision, all must be resolved before the deliverable is accepted; picks are recorded per item. If the founder rejects every option on any one decision, the whole task is returned to the department with a note and the recorded picks are discarded.
- **Recording.** The picked option is recorded on the Task Completion Event and in the accepted artifact's payload under its `decisionKind`, and is carried in the downstream handoff context. A new `acceptanceProvenance` value `founder_decision` joins `manual_ceo_review` and `automatic_acceptance`.
- **Lifecycle.** An unresolved Founder Decision sits indefinitely — no timeout, no auto-resolution, no default selection. Downstream tasks that depend on the deliverable show a derived "waiting on decision" display state, computed from "dependency-blocked and an upstream deliverable has an unresolved `founder_decision`". It is not a new persisted `Task` status.
- **Attention.** An unresolved Founder Decision creates a CEO Attention Item (new reason `founder_decision` in `ceoAttention.ts`), so it appears both pinned in the Outcomes view and grouped in Attention Rollups. Resolved Founder Decisions do not.

### Phase B — Information presentation

- **Task Outcome Summary.** A new natural-language summary the completing agent produces, answering: the conclusion reached; what it means for the objective or vision it serves; what gap remains (remaining Vision Gap, in prose); and, only when a Founder Decision exists, the options with their trade-offs and the agent's recommendation. The first three are required for every deliverable. The runtime does not check the summary's meaning but detects missing fields the way it detects other required artifact fields. It is stored as a localized-text field on `TaskCompletionEvent` and is distinct from the existing Task Execution Summary (failure facts).
- **Outcomes view.** CEO Office gains an Outcomes view: recent Task Completion Events grouped by objective, each showing its Task Outcome Summary, with unresolved Founder Decisions pinned at the top as the actionable items. The existing Review, Decision, and Blocked queues remain but move to a secondary position. This is not a full CEO home redesign.
- **Residual manual review.** Manual CEO review narrows to one case: a deliverable caught by the tightened risk-pattern scan. The Decision Queue and Blocked Queue are untouched. The review detail panel is restructured to lead with the Task Outcome Summary conclusion and to collapse proof type/URI, artifact kind/role/subtype, and validation/review status into a secondary "evidence and validation" section.

### Migration

No data backfill: no Task Outcome Summary or Task Completion Event is synthesized for already-`complete` tasks. On ship, a one-time reconciliation re-evaluates tasks currently in `review` against the deterministic acceptance check — accepting those that qualify (provenance `automatic_acceptance`, no summary) and moving the rest to the restructured manual panel. Existing `blocked` tasks follow their normal paths. The known stuck company is not migrated, following the ADR 0015 precedent.

## Consequences

- CEO Office becomes a company-state surface: for most completed tasks the founder reads a conclusion, and the only interruption is a genuine strategic choice.
- This is the second revision of the CEO Review model. ADR 0007 made CEO Office the owner of review decisions; ADR 0014 said review should not be the default path; this ADR makes the non-default real and defines what replaces it.
- **`riskLevel` no longer gates acceptance.** A future reader looking at `evaluateAutomaticAcceptance` should not re-add a risk-level check expecting it to be meaningful — the CEO Agent's labelling was found unreliable and the deterministic pattern scan plus Founder Decision are the safety model.
- **Direction Drift and the unproduced `validationStatus` values remain aspirational.** `CONTEXT.md` describes Direction Drift, `invalid_drift`, `invalid_blocker`, and `stale`; none are produced by any code path today, and this change does not build them. Founder Decision is deliberately scoped by a fixed enum *instead of* the unbuilt inherited-decision-field model so it does not depend on that foundation.
- **Founder Approval stays as-is.** There is no central Founder Approval trigger list and the `approvalRequired` callback has no production caller; this change builds only the Founder Decision half of the first-value / later-change split.
- A new `NextStepItemType`, a new `acceptanceProvenance` value, and a new `Strategic Decision Kind` enum are added to `packages/core` and its zod schemas — additive, but they widen the persisted vocabulary and cannot be removed without a migration.
