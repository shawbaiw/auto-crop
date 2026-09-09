# 06: Localize Timeline Enums And Runtime Strings

**What to build:** Every internal code and runtime-authored string in the CEO Office timeline renders through a locale-aware formatter or an existing localization helper. No more raw `snake_case` in the founder's view.

**Blocked by:** 01 (Add Company Canonical Locale)

**Status:** ready-for-agent

- [ ] Dashboard formatters for enum-class values: completion `outcome`, item `status` (replace `formatTimelineStatus`'s underscore-swap with translation keys), and reuse the existing `formatDecisionKind`.
- [ ] Human-action `label` and wait-state / blocked-issue `reason` render through the localization path rather than as raw agent strings.
- [ ] `translations.ts` gains keys for every outcome value, status value, and the empty-list fallbacks.
- [ ] Runtime-generated strings (wait-state detail, blocker reason) that are deterministic use `runtimeText(en, zh)` in `localizedRuntimeText.ts`; agent-authored ones follow the company-locale rule from issues 02–03.
- [ ] `formatTimelineDependencies` and `formatTimelineTasks` take `tasksById` and render task titles; the hardcoded `"N tasks"` / `"task"` fallback is localized.
- [ ] Tests: `outcome`, `status`, `decisionKind`, and wait/blocked reasons never render as raw `snake_case` in the timeline; dependency and affected-task references render as titles, never IDs.

**Implementation note:** No redesign of the `WaitState` or blocked-issue data models. No historical backfill — a migration fallback (show the raw string until re-authored) is acceptable for old rows.
