# 02: Report survives a CEO Agent failure via a deterministic fallback

**What to build:** A generation failure never leaves the founder without a report. When the CEO Agent run that authors a Final Founder Report fails or times out, the runtime retries to a bounded ceiling; on exhaustion it assembles a **deterministic report** from `summarizeFounderReport` projection data — every factual section populated (vision, department contributions, remaining gaps) and the synthesis sections (actual result, goal fit, recommended next step) filled from templates over Task Outcome Summaries and Vision Gaps rather than agent prose. The deterministic report is a normal `isCurrent` `founder_reports` record marked `generatedBy: deterministic_fallback`, and CEO Office shows it exactly like an agent-authored one.

**Blocked by:** 01.

**Status:** done

- [x] Retry the authoring run to a ceiling, reusing the Bounded Recovery ceiling pattern.
- [x] On exhaustion, build the deterministic report payload from `summarizeFounderReport` data + templated synthesis sections, keyed to the same computed classification.
- [x] Persist as an `isCurrent` `founder_reports` record with `generatedBy: deterministic_fallback`.
- [x] `summarizeFounderReport` is refactored only as far as needed to be the shared factual data source; its existing output shape and route behaviour are unchanged.
- [x] Tests — Seam 1 (`scheduler.test.ts`): a fake CEO adapter that fails every attempt still yields a persisted Final Founder Report record marked `generatedBy: deterministic_fallback`, with the classification and every factual section populated.
- [x] Tests — Seam 3 (`App.test.tsx`) or Seam 2: a `deterministic_fallback` report renders in the pinned panel identically to a `ceo_agent` one.

**Implementation notes:**
- `summarizeFounderReport` (plus `groupTaskDependenciesByTaskId` / `formatWaitStateNextStep`) moved verbatim from `routes.ts` to `apps/server/src/runtime/founderReportProjection.ts`; the route imports it back, output shape unchanged. Its artifact parameter is now a `Pick<BusinessArtifact, …>` structural type so both the raw record and the API's summarized shape satisfy it.
- Retry ceiling `MAX_FINAL_REPORT_AUTHORING_ATTEMPTS = 3` lives in `finalFounderReport.ts`; `generateFinalFounderReport` loops `authorFinalFounderReportSections` to the ceiling, then calls `buildDeterministicFinalFounderReportSections` and stamps `generatedBy: deterministic_fallback`. The classification is still the runtime-computed value, identical for both paths.
- Deterministic synthesis sections are bilingual templates via `runtimeText(en, zh)`; `actualResult` folds in accepted Task Outcome Summary text, `recommendedNextStep` reuses the projection's `nextSteps` / Wait State list.
- The scheduler's `maybeGenerateFinalFounderReport` try/catch now only guards an unexpected failure (e.g. the DB write) since the fallback is internal.
