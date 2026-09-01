# Localized Business Content Spec

## Goal

When the Interface Locale is English, all Auto-Crop-authored interface and business content renders in English. When the Interface Locale is Chinese, all Auto-Crop-authored interface and business content renders in Chinese.

Raw source content remains raw: user-provided company names, Founder Vision text, CEO Intake text, URLs, file paths, command output, and agent brand names are not translated merely because the Interface Locale changes.

## Context

ADR-0013 defines Localized Business Content as department names, department responsibilities, objective titles, task titles, task descriptions, progress labels, system activity messages, and localized summaries of agent output. The current dashboard already has a translation provider for static UI chrome, but much of the content shown in the UI is persisted or generated as single-language strings.

## Scope

- Static dashboard UI strings must use translation keys.
- Internal enum/code values must remain stable machine-readable codes and be formatted for display through locale-aware formatters.
- Playbook-authored departments, objectives, key results, tasks, proof schemas, review criteria, and handoff contracts must have localized representations.
- Runtime-authored task progress labels and system activity messages must have localized representations or stable semantic keys with values.
- Agent-authored blueprint content should carry localized business content when it is shown as product UI.
- Existing raw source content must remain available without forced translation.

## Out Of Scope

- Translating user-provided company names, Founder Vision, CEO Intake bodies, URLs, file paths, command output, or agent brand names.
- Replacing the current dashboard language provider with a third-party i18n library as the first step.
- Retrofitting historical data perfectly without a migration fallback path.

## Implementation Shape

Introduce a shared `Locale` and `LocalizedText` concept in the core package. Use this for Auto-Crop-authored business content that must switch languages after data has been persisted.

Keep existing string fields available during the transition where needed for compatibility, but add explicit locale-aware accessors at API or UI boundaries so callers do not display raw English accidentally.

For deterministic playbook content, prefer stable localization keys or embedded `LocalizedText` values over runtime machine translation. For agent-authored content, require the CEO prompt and parsers to accept localized fields for user-facing business content. If localized fields are missing, the UI should fall back intentionally and tests should make that fallback visible.

## Acceptance Criteria

- Switching the dashboard to English renders static UI, departments, objectives, task titles, task descriptions, progress labels, and system-authored messages in English.
- Switching the dashboard to Chinese renders those same Auto-Crop-authored fields in Chinese.
- User-provided company names, Founder Vision, CEO Intake text, URLs, file paths, command output, and agent brand names remain unchanged.
- Internal codes such as task status, artifact kind, review status, proof type, risk level, failure reason, and capability tags are never displayed raw in ordinary dashboard UI.
- Tests cover at least one English and one Chinese company creation/dashboard path.

## Ticket Plan

1. Audit and localize static UI plus enum display formatters.
2. Add core localization types and API/UI display helpers.
3. Convert deterministic playbook content to localized content.
4. Extend CEO prompt, parser, and runtime templates for localized business content.
5. Update dashboard rendering and end-to-end tests for complete locale switching.

