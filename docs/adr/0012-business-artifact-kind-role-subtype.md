# Business Artifact Kind, Role, and Subtype

Auto-Crop will replace the old single `artifactType` concept with Artifact Kind, Artifact Role, and Artifact Subtype. Kind drives workflow behavior, Role describes the stable handoff shape, and Subtype carries playbook-specific business names such as `keyword_research`. This avoids repeatedly adding enum mappings whenever an agent names a valid use-case-specific artifact differently.

## Considered Options

- Keep a closed `artifactType` enum and add aliases such as `keyword_research -> research_findings`.
- Make artifact types fully open strings.
- Split artifact classification into workflow kind, generic role, and business subtype.

## Decision

Business Artifact validation will gate on a small closed set of Artifact Kinds and Artifact Roles. The first Artifact Kinds are `deliverable`, `blocker`, `decision_request`, `direction_change_request`, and `final_report`. The first Artifact Roles are `findings`, `plan`, `spec`, `implementation`, `validation`, `launch`, `report`, and `none`.

Artifact Subtype will be an open string: unknown subtypes may warn, but they must not fail structural validation by name alone. Payload validation is selected by `task_type + artifact_role + artifact_subtype`, with role-level minimum schemas as the fallback when no subtype schema exists.

CEO Office will show three distinct queues: a Review Queue for valid reviewable deliverables, a Decision Queue for decision and direction-change requests, and a Blocked Queue for missing, invalid, stale, blocked, or otherwise non-reviewable artifacts. Invalid artifacts should not be sent to ordinary CEO review, and schema-invalid artifacts should move the task to `blocked` with a specific failure reason instead of looping through return and automatic rerun.

The runtime will temporarily read legacy `artifactType` values. Unknown legacy values with otherwise valid artifact structure may be inferred as Artifact Subtypes using task and proof context to infer Kind and Role. This compatibility lasts through the migration that adds persisted kind, role, and subtype fields plus one cleanup migration; it is not a permanent alias table.
