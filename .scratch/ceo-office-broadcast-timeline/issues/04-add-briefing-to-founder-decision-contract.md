# 04: Add A Briefing To The Founder Decision Contract

**What to build:** A `briefing` field on the `open_decisions` declaration and the `FounderDecision` model — the substance the founder needs to decide from the card alone: what was explored, where the opportunity is, what is differentiated, the monetization angle and why. This is what makes the Decision card the post-task "说明" surface.

**Blocked by:** 01 (Add Company Canonical Locale)

**Status:** complete

- [x] `briefing` added to `FounderDecisionDeclaration`, the `FounderDecision` type, and the `open_decisions` entry contract. Stored as the company-locale plain string (like the sibling `rationale`), not `LocalizedText` — matches issue 03's precedent. There is no zod schema for the `open_decisions` contract; it is hand-parsed in `founderDecision.ts`.
- [x] No DB column: `FounderDecision` is not a persisted record — it is projected by `collectFounderDecisions` from the `founder_decision` Next Step Item's JSON bag on the Task Completion Event. `briefing` rides in that bag exactly like `rationale` / `options`; no migration.
- [x] `parseKnownEntry` validates `briefing` is present and non-empty for a kept entry, exactly like `rationale` (shared `requireField` helper); a known `decisionKind` entry missing `briefing` is a structural validation failure.
- [x] `label`, `tradeoffs`, `recommendation`, `rationale`, and `briefing` are collapsed to the company-locale value via `resolveMaybeLocalized` (bare string or `{ en, zh }` object accepted); `parseOpenDecisions` takes a required `locale` and all four call sites thread the company locale.
- [x] The projected `decision_request` item carries `briefing`; `routes.ts` serialization and `CeoOfficeItemSummary` (= `CEOOfficeItem`) include it via the core `Pick`.
- [x] The task-execution prompt's Open Decisions section documents `briefing`, what it must cover, and that a missing one fails validation like a missing `rationale`; the localized JSON example carries a `briefing`.
- [x] Tests: `businessArtifact.test.ts` — a known-kind entry without `briefing` fails validation, with it is kept; `routes.test.ts` — the projected `decision_request` carries `briefing` and company-state `founderDecisions` serialization includes it; `founderDecision.test.ts` — the locale-collapse / fallback rule.

**Implementation note (added during build):** ADR 0017 amended with the widened `open_decisions` declaration; `CONTEXT.md` gains a Founder Decision Briefing glossary entry. The dashboard Decision card leading with the briefing is deferred to the timeline-UI issue (07); this issue only threads the data through serialization.

**Implementation note:** Not a new CEO Office Item type — `briefing` rides on `decision_request`. The resolution API (`POST /founder-decisions` pick / return) does not change. No structured sub-fields inside `briefing` in v1. `decisionKind` enum unchanged. A completed task with no `open_decisions` still produces only a Report and no Decision card.
