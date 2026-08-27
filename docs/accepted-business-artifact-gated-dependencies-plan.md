# Accepted Business Artifact Gated Dependencies Plan

## Status

Planned. This plan captures the first implementation phase for preventing invalid handoffs, silent direction drift, and misleading completion states.

## Goal

Make Auto-Crop's department workflow produce results that match the founder's vision by requiring downstream work to consume accepted, current, valid Business Artifacts rather than raw Proof files.

The first acceptance target is a fresh end-to-end run where:

- Research produces structured findings.
- Product cannot pass unless it creates a structured MVP brief that references the accepted Research artifact.
- Engineering cannot start while Product is in `review`, returned, invalid, or blocked.
- Engineering cannot change product direction without an approved Direction Change Request.
- Growth cannot start without accepted upstream Business Artifacts.
- The user can see a final or blocked founder-facing report without opening every department.

## Non-Goals

- Do not hard-code SEO as the system model. SEO is only the first test scenario.
- Do not immediately replace every task status with `execution_status`, `review_status`, and `business_status`.
- Do not add an AI semantic judge in the first phase.
- Do not redesign the dashboard visual system.
- Do not make the founder manually approve every ordinary department review.

## Key Decisions

- Proof and Business Artifact are separate concepts.
- Proof Schema describes evidence carrier shape; Task Type and playbook rules describe business semantics.
- Business Artifacts are stored in the database, not only in task workspaces.
- Every downstream-consumable task has an `expected_artifact_type`.
- Artifact payload schema is selected by `task_type` with playbook defaults.
- Scheduler readiness requires accepted, current, valid Business Artifacts and valid lineage.
- Review-stage Proof is never consumable by downstream tasks.
- Blocker Reports are diagnostic and not ordinary handoffs.
- Direction Drift is a hard block unless covered by Founder Approval.
- Existing code structure may inform technical implementation, but business direction must come from accepted Product artifacts.
- UI changes must reuse existing retro components where possible.

## Data Model

Add `business_artifacts`.

Suggested columns:

```sql
CREATE TABLE business_artifacts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_proof_id TEXT REFERENCES proofs(id) ON DELETE SET NULL,
  artifact_type TEXT NOT NULL,
  task_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  lineage_json TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  validation_errors_json TEXT NOT NULL,
  review_status TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1,
  supersedes_artifact_id TEXT REFERENCES business_artifacts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Indexes:

```sql
CREATE INDEX business_artifacts_task_current_idx
  ON business_artifacts(task_id, is_current, validation_status, review_status);

CREATE INDEX business_artifacts_company_type_idx
  ON business_artifacts(company_id, artifact_type, is_current);
```

First-phase `validation_status` values:

- `pending`
- `valid`
- `invalid_schema`
- `invalid_blocker`
- `invalid_drift`
- `stale`

First-phase `review_status` values:

- `unreviewed`
- `accepted`
- `returned`
- `not_reviewable`

## Core Types

Add shared core types for:

- `BusinessArtifact`
- `BusinessArtifactType`
- `BusinessArtifactValidationStatus`
- `BusinessArtifactReviewStatus`
- `ArtifactLineage`
- `ArtifactValidationError`
- `DirectionChangeRequestPayload`

Generic Artifact Types:

```txt
research_findings
product_mvp_brief
implementation_summary
validation_result
preview_result
launch_plan
deployment_result
final_founder_report
blocker_report
direction_change_request
```

Task Type examples:

```txt
research.seo_keyword_opportunity
research.customer_pain
research.pricing
product.mvp_brief
engineering.prototype_implementation
engineering.validation
growth.launch_plan
ceo.final_founder_report
```

## Schema Registry

Create a deterministic registry in server runtime for the first phase.

The registry should map:

```ts
taskType -> {
  expectedArtifactType,
  payloadSchema,
  requiredDecisionFields,
  inheritedDecisionFields,
  downstreamContracts
}
```

The registry must not assume every Research artifact is SEO-related. A `research_findings` artifact can carry different payload schemas based on `task_type` and `payload.research_kind`.

Document in the ADR that the registry should move into playbook configuration later.

## Artifact Creation

Update task prompts to require agents to write `.auto-crop-artifact.json` in the task workspace for deliverable tasks.

Prompt requirements:

- identify `artifact_type`
- identify `task_type`
- include `lineage`
- include payload fields required by the task type
- list consumed upstream Business Artifact IDs
- declare blocker state explicitly if the deliverable cannot be produced

Support markdown fenced JSON only as a compatibility fallback. Prefer `.auto-crop-artifact.json`.

## Proof Capture Integration

After Proof capture:

1. Look for `.auto-crop-artifact.json` in the task workspace.
2. If absent, look for a fenced JSON Business Artifact block in the declared Proof file.
3. If neither exists for a task that needs a Business Artifact, create an invalid artifact record with `invalid_schema`.
4. Run deterministic validation.
5. Store the Business Artifact with validation errors.
6. Mark older current artifacts for the same task as not current when a replacement artifact is created.
7. Move tasks with normal valid artifacts to `review`.
8. Move tasks with `blocker_report` or invalid artifacts to a non-consumable review/return path according to the review rules below.

Blocker text scanning should detect phrases such as:

- `need permission`
- `read access`
- `cannot proceed`
- `can't proceed`
- `blocked`
- `unable to read`
- `please grant`

Blocker scanning is an auxiliary guard. Artifact validation remains the primary rule.

## Dependency Readiness

Replace proof-existence readiness with accepted Business Artifact readiness.

A downstream task may start only when every direct dependency has:

- `task.status = complete`
- latest CEO Review Decision is `approve`
- a current Business Artifact matching the expected dependency contract
- `validation_status = valid`
- `review_status = accepted`
- `is_current = true`
- valid lineage back through its ancestors
- no unapproved Direction Change Request

Statuses that must not unlock downstream work:

- `queued`
- `waiting_dependency`
- `running`
- `retrying`
- `review`
- `blocked`
- `failed`
- `cancelled`
- `needs_replan`

This means a task in `review` can be inspected by CEO Office but cannot act as a downstream handoff.

## Lineage And Drift

Each Business Artifact lineage should include:

- founder vision or company ID
- objective IDs or key result IDs when known
- consumed upstream task IDs
- consumed upstream Business Artifact IDs
- direction change request ID when applicable

Drift checks should be deterministic in the first phase:

- strict equality for core identifiers such as selected keyword, recommended path ID, target platform, product category, or MVP type when those fields are declared as inherited decision fields
- allow descriptive fields such as target user or positioning to be refined when lineage is preserved
- block when an Engineering implementation declares a different product category, keyword, MVP type, or workflow than the accepted Product artifact
- scan implementation metadata, title, H1, sitemap, and obvious product names for strong mismatch with the accepted Product artifact

If drift is detected, create or update an artifact with `invalid_drift`. Downstream work remains blocked unless an approved Direction Change Request exists.

## CEO Review

Update review application logic so normal task approval requires:

- Proof exists
- current Business Artifact exists
- Business Artifact validation is `valid`
- Business Artifact is not stale
- Business Artifact is not a Blocker Report
- no unapproved Direction Change Request applies

If these checks fail, the API should reject approve with a specific reason. Return and replan remain available.

When CEO Office approves a task:

- set the task to `complete`
- set the current Business Artifact `review_status` to `accepted`
- mark linked Key Results from accepted artifacts where deterministic mappings exist
- run dependency cascade using the new Business Artifact readiness rules

When CEO Office returns a task:

- set the task back to `queued`
- mark its current artifact `review_status = returned`
- mark downstream artifacts that consumed it as `stale` or block their consumption
- do not start or continue dependent tasks from the returned artifact

Founder Approval is required for:

- changing selected market, keyword, or comparable core research decision
- changing MVP type
- Engineering changing product direction
- publishing to a public URL
- submitting Google Search Console or sitemap actions
- spending money
- connecting ads, affiliate accounts, or API keys

## Scheduler And Cascade

Update `resolveDependencyReadiness` to return handoffs from Business Artifacts instead of Proof.

The handoff prompt should include:

- upstream task title
- Business Artifact ID
- artifact type
- task type
- validation status
- accepted payload summary
- lineage
- source Proof URI for audit only

Do not include raw Proof URI as the primary business instruction.

Dependency Cascade after CEO approval should re-evaluate consumers using the same Business Artifact readiness service.

## Final And Blocked Founder Reports

Add a CEO-owned report task or runtime generation step that produces:

- a structured `final_founder_report` Business Artifact
- a readable markdown report

Generate a final report when all required goals are accepted or explicitly closed. Generate a blocked report when the workflow cannot proceed because of invalid artifacts, missing approvals, needs-replan, or failed dependencies.

Report payload should include:

- original vision
- actual result
- department inputs and outputs
- accepted Business Artifact chain
- goal fit
- drift status
- remaining gaps
- recommended next step

## API Scope

Add repository APIs:

- create Business Artifact
- list Business Artifacts by company
- get current artifact for task
- get current artifact by task and type
- update validation status
- update review status
- mark previous artifacts not current
- mark artifacts stale by consumed upstream artifact

Extend company state response with summarized Business Artifacts and artifact statuses.

Extend CEO review decision responses with artifact validation failures and cascade results.

## Dashboard Scope

Reuse existing dashboard components:

- `RetroBadge` for artifact status
- `RetroPanel` for final or blocked founder reports
- `RetroListRow` or existing task cards for lineage entries
- existing review queue components for approve/return controls

Minimum UI changes:

- task cards show artifact status: valid, invalid, blocker, drift, stale
- review queue explains why approve is disabled
- CEO workspace shows a concise lineage chain from vision to current department artifacts
- final or blocked founder report appears in the CEO workspace or review area

Do not introduce a new visual language. Create only small composition components when existing retro primitives cannot express the state clearly.

## Testing Plan

Unit tests:

- validates each generic artifact type enum
- validates task-type-specific payload schemas
- rejects missing required fields
- detects blocker phrases
- detects product-to-engineering drift for strict inherited fields
- accepts descriptive field refinement when lineage is preserved

Repository tests:

- migrates and creates `business_artifacts`
- lists current artifacts
- marks old artifacts not current
- marks returned artifacts and consumers stale

Proof tests:

- captures `.auto-crop-artifact.json`
- extracts fenced JSON fallback
- records `invalid_schema` when artifact is absent
- records `invalid_blocker` when blocker text is detected

Scheduler tests:

- does not start downstream task while upstream is `review`
- does not start downstream task when upstream has Proof but no valid Business Artifact
- does not start downstream task when upstream artifact is valid but not CEO accepted
- starts downstream task only after upstream accepted current valid artifact
- passes Business Artifact handoff payload, not raw Proof as business instruction
- blocks on invalid lineage or unapproved drift

CEO review API tests:

- rejects approve when normal task lacks valid Business Artifact
- rejects approve for Blocker Report
- accepts valid artifact and marks it `accepted`
- return marks artifact `returned` and prevents downstream consumption

Dashboard tests:

- review queue disables approve for invalid/blocker/drift/stale artifact
- task card displays artifact status
- CEO workspace shows lineage chain
- final or blocked founder report renders using existing retro primitives

End-to-end regression:

- create a company with a keyword-to-site founder vision
- make Research produce valid `research_findings`
- make Product produce a blocker report
- assert Engineering never starts
- return Product
- make Product produce valid `product_mvp_brief`
- approve Product
- assert Engineering starts with the accepted Product artifact
- make Engineering attempt a mismatched product direction
- assert drift is detected and downstream Growth does not start
- approve a Direction Change Request
- assert the revised chain can proceed

## Implementation Phases

### Phase 1: Documentation And Domain Model

- Update `CONTEXT.md` glossary.
- Add the ADR.
- Add this execution plan.
- Confirm terminology in tests and comments stops using Consumable Proof for downstream business handoffs.

### Phase 2: Database And Core Types

- Add `business_artifacts` migration.
- Add core TypeScript types and schemas.
- Add repository CRUD and current-artifact helpers.
- Add tests for persistence and migration.

### Phase 3: Artifact Validation

- Add artifact schema registry.
- Add artifact parser for `.auto-crop-artifact.json` and fenced JSON fallback.
- Add blocker detection.
- Add lineage and drift validation helpers.
- Add unit tests for all validation outcomes.

### Phase 4: Proof Capture And Review Gate

- Integrate artifact extraction after Proof capture.
- Prevent normal review approval without a valid current artifact.
- Mark accepted/returned artifact review statuses during CEO review.
- Add API tests for approve rejection and accepted artifact updates.

### Phase 5: Scheduler And Cascade

- Replace dependency readiness Proof checks with Business Artifact checks.
- Change handoff prompt construction to pass accepted artifact details.
- Ensure `review` status never unlocks downstream execution.
- Update dependency cascade to share the same readiness service.
- Add scheduler and cascade regression tests.

### Phase 6: UI

- Add artifact summaries to company state.
- Show artifact status on task cards.
- Explain invalid approval reasons in review queue.
- Add lineage display and final/blocked report panels using existing retro components.
- Add dashboard tests.

### Phase 7: Founder Reports And KR Updates

- Generate final or blocked founder reports.
- Store report as both Business Artifact and readable markdown.
- Update Key Results from accepted Business Artifacts and report reconciliation.
- Add tests for blocked and successful workflows.

## Follow-On Work

- Split `tasks.status` into `execution_status`, `review_status`, and `business_status`.
- Move artifact schema registry into playbook configuration.
- Add optional AI semantic review after deterministic validation.
- Add Founder Approval UI and persistence for direction changes and external actions.
- Add a richer artifact lineage graph.
- Add artifact revision browser.
- Revisit workspace isolation so downstream agents never need sibling workspace file reads.

