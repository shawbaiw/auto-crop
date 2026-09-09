# 03: Normalize Execution Report Fields To The Company Locale

**What to build:** The Execution Report parser stores a bare string under the company locale key instead of always `en`, and validation requires the company-locale value — but a missing value is a visible marker in the UI, not a validation failure.

**Blocked by:** 01 (Add Company Canonical Locale)

**Status:** complete

- [x] `parseExecutionReportInput` takes a `locale` argument; a bare string normalizes to `{ [locale]: value }`; an `{ en, zh }` object is accepted unchanged.
- [x] `locale` is threaded from `taskCompletion.ts` and `businessArtifact.ts` (both have the company).
- [x] `executionReportFieldError` requires the company-locale value to be non-empty on `deliverable` / `final_report`; it does not require both locales. A completely absent `execution_report` still fails validation as today.
- [x] The four-field structure (`conclusion`, `visionImpact`, `remainingGap`, `recommendation`) is unchanged; `outcome_summary` stays as the compatibility fallback.
- [x] The dashboard `line()` helper renders a visible "未翻译 / untranslated" marker when the company-locale value is absent, instead of silently returning `.en`; the absence is logged.
- [x] Tests: a bare Chinese string on a `zh` company stores as `{ zh }` and renders with no marker; a report missing the `zh` value renders the marker and is still accepted; an entirely missing `execution_report` still fails validation.

**Implementation note:** `executionReportSchema` (four `localizedTextSchema`) does not change — only the normalization default key and the required-locale check. Decision 2 in the spec: the marker never blocks task completion or acceptance.
