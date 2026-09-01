# Core Localization Model

Status: resolved
Blocked by: 01

## Goal

Introduce shared domain types and boundary helpers for Localized Business Content.

## Scope

- Add shared `Locale` and `LocalizedText` concepts in the core package.
- Decide the compatibility shape for existing single-string fields during migration.
- Add helpers for resolving localized content by Interface Locale with explicit fallback behavior.
- Update API summary types or mapping helpers so UI callers can request/display localized fields without reimplementing fallback logic in components.
- Keep raw source content separate from Localized Business Content.

## Acceptance Criteria

- Core types can represent English and Chinese text for Auto-Crop-authored business content.
- UI-facing summaries have a clear way to get the display value for the active Interface Locale.
- Fallbacks are intentional and test-covered.
- Existing data can still load during the transition.

## Tests

- Add core tests for localized text resolution and fallback.
- Add API mapping tests for at least department, objective, task, progress event, and proof summary localization fields.

## Notes

Prefer a small, boring model. This ticket is about the contract, not converting every producer yet.

## Resolution

- Added core `Locale`, `LocalizedText`, `CompleteLocalizedText`, `localizedTextFromString`, and `resolveLocalizedText`.
- Added `localeSchema` and `localizedTextSchema` with explicit non-empty validation.
- Added migration-compatible localized API summary fields for company, CEO intake/review notes, departments, objectives, tasks, progress events, proof summaries, task events, and replan proposals.
- Kept legacy string fields in API summaries so existing data and callers continue to work during migration.

## Verification

- `pnpm --filter @auto-crop/core test`
- `pnpm --filter @auto-crop/core typecheck`
- `pnpm --filter @auto-crop/server test`
- `pnpm --filter @auto-crop/server typecheck`
- `pnpm --filter @auto-crop/dashboard typecheck`
