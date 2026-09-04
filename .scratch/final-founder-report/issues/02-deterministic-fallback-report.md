# 02: Report survives a CEO Agent failure via a deterministic fallback

**What to build:** A generation failure never leaves the founder without a report. When the CEO Agent run that authors a Final Founder Report fails or times out, the runtime retries to a bounded ceiling; on exhaustion it assembles a **deterministic report** from `summarizeFounderReport` projection data — every factual section populated (vision, department contributions, remaining gaps) and the synthesis sections (actual result, goal fit, recommended next step) filled from templates over Task Outcome Summaries and Vision Gaps rather than agent prose. The deterministic report is a normal `isCurrent` `founder_reports` record marked `generatedBy: deterministic_fallback`, and CEO Office shows it exactly like an agent-authored one.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Retry the authoring run to a ceiling, reusing the Bounded Recovery ceiling pattern.
- [ ] On exhaustion, build the deterministic report payload from `summarizeFounderReport` data + templated synthesis sections, keyed to the same computed classification.
- [ ] Persist as an `isCurrent` `founder_reports` record with `generatedBy: deterministic_fallback`.
- [ ] `summarizeFounderReport` is refactored only as far as needed to be the shared factual data source; its existing output shape and route behaviour are unchanged.
- [ ] Tests — Seam 1 (`scheduler.test.ts`): a fake CEO adapter that fails every attempt still yields a persisted Final Founder Report record marked `generatedBy: deterministic_fallback`, with the classification and every factual section populated.
- [ ] Tests — Seam 3 (`App.test.tsx`) or Seam 2: a `deterministic_fallback` report renders in the pinned panel identically to a `ceo_agent` one.
