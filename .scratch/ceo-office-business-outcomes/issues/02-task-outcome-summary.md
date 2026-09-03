# 02: Task Outcome Summary

**What to build:** A completing agent produces a plain-language **Task Outcome Summary** as part of its deliverable — the conclusion it reached, what that means for the objective it serves, and what gap still remains toward the vision. The founder can read that conclusion instead of the proof file and validation status behind it. The CEO task-review detail panel leads with the summary, and the proof and artifact-classification detail moves into a collapsed secondary section.

Governing decision: `docs/adr/0017-ceo-office-surfaces-business-outcomes.md`. Spec: `.scratch/ceo-office-business-outcomes/spec.md`.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `TaskCompletionEvent` carries a nullable, localized-text-shaped `outcomeSummaryText`, added to the core type, its zod schema, persistence (with migration), repository mapping, and the company-state serializer.
- [ ] The task prompt instructs the completing agent to produce the summary with the three required parts (conclusion; meaning for the objective; remaining gap), plus a fourth part (options, trade-offs, recommendation) only when there is a Founder Decision.
- [ ] Business Artifact parsing requires an outcome-summary field on `deliverable` and `final_report` artifacts; a missing summary is a structural validation failure like any other required-field failure. The runtime does not judge the summary's meaning.
- [ ] The captured summary is attached to the Task Completion Event when the event is built.
- [ ] The company-state response serializes `outcomeSummaryText` on Task Completion Events.
- [ ] The CEO task-review detail panel leads with the Task Outcome Summary conclusion. Proof summary, proof type and URI, artifact kind/role/subtype, and validation and review status move into a collapsed "evidence and validation" section, not the primary view.
- [ ] Tests: the acceptance seam for the required-field validation and event attachment; the company-state route test for serialization; the dashboard CEO Workspace test for the restructured panel — each following existing prior art at that seam.
