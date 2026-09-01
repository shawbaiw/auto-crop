# Dashboard Complete Locale Switching

Status: ready-for-agent
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

