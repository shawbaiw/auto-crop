# 08: Move Final Founder Report To Single Locale And Amend ADRs

**What to build:** Bring the Final Founder Report agent onto the same single-canonical-locale contract as task execution, and record the model changes in ADR 0019 and ADR 0013.

**Blocked by:** 01 (Add Company Canonical Locale)

**Status:** ready-for-agent

- [ ] `buildFinalFounderReportPrompt` injects the company locale and requires each section value (`vision`, `actualResult`, `departmentContributions[]`, `goalFit`, `remainingGaps`, `recommendedNextStep`) to be authored in the company language; the "provide both locales" `{ en, zh }` output-contract wording is replaced with single-locale authoring.
- [ ] The Final Founder Report parser stores section values under the company locale key; the deterministic-fallback path (`runtimeText(en, zh)`) still fills a usable value when the agent output is unusable.
- [ ] The dashboard renders Final Founder Report sections through the same `line()` helper with the visible untranslated marker.
- [ ] ADR 0019 is amended: the Task Brief is a one-line announcement; the Decision card ("说明") is the post-task substance surface and stands alone while a task awaits the founder's decision; Execution Reports are projected only for `accepted` outcomes, with exceptions carried by their own card types.
- [ ] ADR 0013 is extended: generated founder-facing content (task execution, Final Founder Report) is authored in `Company.locale`, a single canonical language; the blueprint path is unchanged; a missing company-locale value renders a visible marker and never blocks the business flow.
- [ ] Tests: a Final Founder Report prompt for a `zh` company requires Chinese section values; the deterministic fallback still produces a readable report.

**Implementation note:** The CEO blueprint prompt (`ceoPrompt.ts`) stays bilingual — out of scope. Only the Final Founder Report prompt moves.
