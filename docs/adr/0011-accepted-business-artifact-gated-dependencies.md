# Accepted Business Artifact Gated Dependencies

Auto-Crop will separate raw Proof from structured Business Artifacts, and dependent tasks will start only after upstream dependencies have accepted, current, valid Business Artifacts. This prevents downstream agents from treating blocker notes, stale proof files, or unrelated workspace content as business direction.

## Context

Recent end-to-end tests exposed a gap between execution completion and business completion.

A Research task produced a keyword recommendation. The Product task could not read the Research report from another task workspace and wrote a blocker note instead of a product brief. The runtime still captured that note as file Proof. Engineering then received the Product Proof, observed that it was a blocker note, and continued by deriving product direction from the existing workspace and repository context. The resulting prototype implemented an unrelated AutoCrop product. Growth later produced a launch plan that mixed generic SEO steps with missing placeholders.

The underlying model treats Proof as both evidence and handoff. A markdown file, URL, command log, or diff can prove that an agent produced something, but it does not prove that the business semantics are valid or consumable by downstream tasks. The current dependency model also lets review-ready Proof influence downstream readiness before CEO Office has accepted the upstream work.

The system needs a general fix. SEO keyword-to-site work is only the test case; Auto-Crop should not hard-code SEO assumptions into dependency rules.

## Considered Options

- **Keep Proof as the only handoff gate:** simplest, but it repeats the failure mode where any file can unlock downstream work.
- **Make proof schemas more specific:** improves naming, but proof schemas describe carriers such as markdown files, logs, URLs, and diffs. They cannot reliably describe business semantics.
- **Use AI semantic review for every Proof:** flexible, but too nondeterministic for the first safety gate and harder to test.
- **Add Business Artifacts derived from Proof:** keeps raw evidence auditable while giving the scheduler, CEO review, UI, and final reporting a structured business object to validate.
- **Immediately split task status into execution, review, and business statuses:** cleaner model, but it touches a large runtime and dashboard surface before the handoff bug is contained.

## Decision

Auto-Crop will introduce **Business Artifacts** as structured, runtime-validated handoff records.

Proof remains the raw evidence carrier. Business Artifacts carry the consumable business semantics. A task may have Proof without having a consumable Business Artifact.

The first implementation will add a `business_artifacts` table with at least:

- `id`
- `company_id`
- `task_id`
- `source_proof_id`
- `artifact_type`
- `task_type`
- `payload_json`
- `lineage_json`
- `validation_status`
- `validation_errors_json`
- `review_status`
- `is_current`
- `supersedes_artifact_id`
- `created_at`
- `updated_at`

Artifact Types are generic and playbook-neutral:

- `research_findings`
- `product_mvp_brief`
- `implementation_summary`
- `validation_result`
- `preview_result`
- `launch_plan`
- `deployment_result`
- `final_founder_report`
- `blocker_report`
- `direction_change_request`

Task Type, not Proof Schema, selects the expected Artifact Type and payload schema. For example, a `research-report` Proof may produce `research_findings` for SEO keyword research, pricing research, customer pain research, or another research kind. The SEO payload shape belongs to `task_type` or playbook configuration, not to the generic Proof Schema.

The first implementation may use a code-level artifact schema registry. The registry should be designed so schemas can later move into playbook configuration.

Dependency Readiness will require every direct dependency to have a **Consumable Business Artifact**:

- upstream task is complete
- the latest CEO Review Decision approved the task
- a current Business Artifact exists for the expected dependency contract
- `validation_status` is `valid`
- `review_status` is `accepted`
- `is_current` is true
- the lineage chain remains valid
- no unapproved Direction Change Request applies

Proof in `review` is not consumable. A Blocker Report is visible diagnostic output but cannot satisfy an ordinary downstream dependency.

CEO Office approval must require valid Business Artifacts for normal deliverable tasks. If a task has Proof but only a blocker, invalid, drifted, or stale artifact, the task may be returned or replanned but not approved.

Engineering may inspect repository structure to decide how to implement an accepted product direction: framework, entry files, package manager, tests, routes, hosting metadata, design primitives, and build commands. Engineering may not infer product semantics from repository names, old generated workspaces, starter content, or previous task artifacts unless those semantics are referenced by an accepted Product Business Artifact.

Direction changes require Founder Approval when they change selected market or keyword, MVP type, product direction, public publishing, Search Console or sitemap submission, spending, ads, affiliate accounts, or API keys. Approved direction changes should be represented as Business Artifacts so the scheduler can validate them deterministically.

The first phase will not migrate `tasks.status` into separate execution, review, and business status columns. Instead, Business Artifact validation and review status will provide the semantic gate. A later migration should split task state once the handoff model is proven.

## Consequences

Downstream agents cannot start from blocker notes, unaccepted review Proof, stale artifacts, or unrelated workspace context. This prevents the most damaging direction-drift path without requiring every task to be manually reviewed by the founder.

The dashboard can show clearer task health: a task can have Proof while its Business Artifact is invalid, blocked, drifted, or stale. Review UI can explain why approval is disabled instead of saying only that a checkable result exists.

The system gains an auditable lineage from Founder Vision through department handoffs to final result. If a workflow ends successfully or blocks, CEO Office can generate a founder-facing report instead of leaving the user to reconstruct the outcome from activity logs.

This adds data model and validation complexity. It also requires playbooks and task prompts to specify expected task types and artifact payloads. The first implementation intentionally uses deterministic validation before any richer AI semantic judge.

Future work should:

- migrate `tasks.status` into `execution_status`, `review_status`, and `business_status`
- move artifact schema definitions from code into playbook configuration
- add richer semantic or AI review after deterministic validation
- add a Founder Approval workflow for direction changes and external launch actions
- add an artifact lineage graph UI
- update Key Results from accepted Business Artifacts and final reports, not task status alone

