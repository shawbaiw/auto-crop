# Static UI And Enum Display

Status: ready-for-agent
Blocked by:

## Goal

Remove raw English UI strings and raw internal enum/code displays from ordinary dashboard UI.

## Scope

- Find dashboard strings that are still hard-coded in components, theme labels, CRT labels, menu labels, aria labels, and error display helpers.
- Add missing translation keys to the existing dashboard translation table.
- Add or extend locale-aware formatters for task status, company status, risk level, proof type, artifact kind, artifact role, artifact type, validation status, review status, failure reason, execution profile label, timeout budget label, and capability tags where they appear in UI.
- Keep URLs, file paths, command output, and agent names raw.

## Acceptance Criteria

- A text search of dashboard source has no ordinary visible labels such as `Profile`, `Budget`, `Issue`, or `Detail` hard-coded in JSX.
- Dashboard UI uses formatter functions for internal enum/code values instead of displaying raw codes directly.
- Existing English UI behavior is preserved.
- Chinese UI does not show raw enum/code English in ordinary labels.

## Tests

- Add or update component tests for formatter output in English and Chinese.
- Add a regression test around CEO task review metadata to prove labels and enum values are localized while paths remain raw.

## Notes

This ticket should not introduce a third-party i18n library. It should make the current `LanguageProvider` path stricter and more complete.

