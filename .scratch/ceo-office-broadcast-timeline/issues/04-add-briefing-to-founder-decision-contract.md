# 04: Add A Briefing To The Founder Decision Contract

**What to build:** A `briefing` field on the `open_decisions` declaration and the `FounderDecision` model — the substance the founder needs to decide from the card alone: what was explored, where the opportunity is, what is differentiated, the monetization angle and why. This is what makes the Decision card the post-task "说明" surface.

**Blocked by:** 01 (Add Company Canonical Locale)

**Status:** ready-for-agent

- [ ] `briefing: LocalizedText` added to `FounderDecisionDeclaration`, the `FounderDecision` type, and the `open_decisions` entry contract — core types and zod schemas.
- [ ] DB column, migration, and repository mapping for `briefing` on the founder-decision record.
- [ ] `parseKnownEntry` validates `briefing` is present and non-empty for a kept entry, exactly like `rationale`; a known `decisionKind` entry missing `briefing` is a structural validation failure.
- [ ] `label`, `tradeoffs`, `rationale`, and `briefing` are stored as `LocalizedText[companyLocale]` (bare strings normalized to the company locale, same rule as issue 03).
- [ ] The projected `decision_request` item carries `briefing`; `routes.ts` serialization and `CeoOfficeItemSummary` include it.
- [ ] The task-execution prompt's Open Decisions section documents `briefing` and what it must cover (issue 02 covers the language requirement; this issue adds the field to the shape).
- [ ] Tests: a known-kind entry without `briefing` fails validation; with `briefing` it is kept, the projected `decision_request` carries it, and company-state serialization includes it.

**Implementation note:** Not a new CEO Office Item type — `briefing` rides on `decision_request`. The resolution API (`POST /founder-decisions` pick / return) does not change. No structured sub-fields inside `briefing` in v1. `decisionKind` enum unchanged. A completed task with no `open_decisions` still produces only a Report and no Decision card.
