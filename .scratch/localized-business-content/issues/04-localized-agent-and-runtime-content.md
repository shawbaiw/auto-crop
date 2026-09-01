# Localized Agent And Runtime Content

Status: ready-for-agent
Blocked by: 02, 03

## Goal

Make CEO agent blueprints and runtime-authored activity/progress content produce Localized Business Content instead of single-language UI strings.

## Scope

- Update the CEO prompt output contract so departments, objectives, key results, task titles, task descriptions, and handoff contracts can carry English and Chinese values.
- Update parsing and fallback behavior for older agent outputs that only contain strings.
- Convert runtime-authored progress labels, task event messages, recovery messages, refresh messages, dependency messages, review decision messages, and scheduler messages to localization keys or localized values.
- Add localized dashboard summaries for agent-produced proof summaries, failure messages, and review notes where Auto-Crop presents them as product UI.
- Preserve original agent output as raw evidence/diagnostic content.

## Acceptance Criteria

- New CEO blueprints can provide both English and Chinese Localized Business Content.
- Runtime-created progress and event messages render according to the active Interface Locale.
- Original raw agent output remains available for proof/debugging without being forced through localization.
- Legacy single-string agent output still loads with an explicit fallback.

## Tests

- Update CEO prompt/parser tests for localized blueprint output.
- Add runtime tests for localized task progress and event messages.
- Add proof/recovery/refresh tests where summaries are localized but raw evidence remains raw.

## Notes

This is the highest-risk ticket because it touches agent contracts. Keep parser compatibility explicit.

