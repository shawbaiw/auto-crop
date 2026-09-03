# 02: Task Outcome Summary

**What to build:** A completing agent produces a plain-language **Task Outcome Summary** as part of its deliverable — the conclusion it reached, what that means for the objective it serves, and what gap still remains toward the vision. The founder can read that conclusion instead of the proof file and validation status behind it. The CEO task-review detail panel leads with the summary, and the proof and artifact-classification detail moves into a collapsed secondary section.

Governing decision: `docs/adr/0017-ceo-office-surfaces-business-outcomes.md`. Spec: `.scratch/ceo-office-business-outcomes/spec.md`.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `TaskCompletionEvent` carries a nullable, localized-text-shaped `outcomeSummaryText`, added to the core type, its zod schema (`localizedTextSchema`, applied where the field is parsed), persistence (`task_completion_events.outcome_summary_text` + `migrateTaskCompletionOutcomeSummary`), repository mapping, and the company-state serializer (`summarizeTaskCompletionEvent`).
- [x] The task prompt (`buildAgentPrompt`) gains a `## Task Outcome Summary` block instructing the completing agent to write `payload.outcome_summary` with the three required parts (conclusion; meaning for the objective; remaining gap), plus a fourth part (options, trade-offs, recommendation) only when leaving a strategic choice for the founder.
- [x] Business Artifact parsing (`parseDeclaredBusinessArtifact`) requires `payload.outcome_summary` (non-empty string or `{ en, zh }`) on `deliverable` and `final_report` artifacts; a missing/malformed field is a structural validation failure. The runtime does not judge the summary's meaning.
- [x] The captured summary is read from the Business Artifact payload and attached to the Task Completion Event in `recordTaskCompletionEvent` (`extractOutcomeSummaryText`).
- [x] The company-state response serializes `outcomeSummaryText` on Task Completion Events (null when absent).
- [x] The CEO task-review detail panel (`CeoTaskReviewDetail`) leads with the Task Outcome Summary. Proof summary, proof type/URI, artifact kind/role/subtype, and validation/review status move into a collapsed `<details>` "Evidence & validation" section.
- [x] Tests: `businessArtifact.test.ts` (required-field validation, localized-object accepted); `scheduler.test.ts` (auto-accept attaches `outcomeSummaryText` to the Task Completion Event); `routes.test.ts` (company-state serialization round-trips localized text, null when absent); `App.test.tsx` (panel leads with the summary, evidence collapsed and ordered after it).

Notes for later issues: `TaskCompletionEventSummary` in the dashboard client now carries `outcomeSummaryText`, but the dashboard does not yet hold `taskCompletionEvents` in app state — issue 05 (Outcomes view) wires that through. The `open_decisions` / Founder Decision fourth part of the summary contract is prompt text only here; issues 03/04 build the decision machinery.
