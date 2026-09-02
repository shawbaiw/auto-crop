# Dashboard Complete Locale Switching

Status: resolved
Blocked by: 01, 02, 03, 04

## Goal

Wire Localized Business Content through the dashboard and verify full English/Chinese switching behavior.

## Scope

- Update dashboard pages to render localized department names, responsibilities, objectives, task titles, task descriptions, progress labels, event summaries, proof summaries, and artifact labels.
- Replace remaining string concatenation patterns with locale-aware full-message templates where word order matters.
- Ensure language switching is immediate from the current in-memory/API state.
- Add E2E or integration coverage for English and Chinese dashboard states.
- Keep raw source content raw.

## Acceptance Criteria

- In English mode, Auto-Crop-authored UI and business content is English.
- In Chinese mode, Auto-Crop-authored UI and business content is Chinese.
- User-provided text, URLs, file paths, command output, and agent brand names are unchanged.
- No raw internal enum/code values appear in ordinary dashboard UI.
- Visual layout remains stable in both languages.

## Tests

- Add a dashboard integration test that toggles language and checks department/task/objective/progress content.
- Add an E2E company flow assertion for Chinese UI and English UI.
- Run unit tests and relevant dashboard E2E tests.

## Notes

This ticket closes the feature and should include a final audit of user-visible strings.

## Resolution

- Added a dashboard localized text resolver with fallback to English and legacy fields.
- Wired localized business content through Company Dashboard, Company Operations, and Department Workspace views.
- Covered department names/responsibilities, objective titles, task titles/descriptions, progress labels, event messages, proof summaries, artifact task labels, and replan proposal content where localized fields exist.
- Preserved raw user/source content such as founder vision, intake body, URLs, file paths, command output, and agent names.

## Verification

- `pnpm --filter @auto-crop/dashboard typecheck`
- `pnpm --filter @auto-crop/dashboard test`
- `pnpm --filter @auto-crop/dashboard exec playwright test` was attempted but could not run because the local Playwright Chromium executable is missing.
