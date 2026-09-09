# 06: Localize Timeline Enums And Runtime Strings

**What to build:** Every internal code and runtime-authored string in the CEO Office timeline renders through a locale-aware formatter or an existing localization helper. No more raw `snake_case` in the founder's view.

**Blocked by:** 01 (Add Company Canonical Locale)

**Status:** complete

- [x] `formatTimelineStatus` and a new `formatCompletionOutcome` map enum values to `translations.ts` keys via a shared `translateTimelineCode` helper; an unmapped value still de-snakes through `formatCodeLabel`. `formatDecisionKind` is reused unchanged.
- [x] Human-action `label` and wait-state / blocked-issue `reason` are `LocalizedText` on the projected item and render through the timeline's `line()` localization path (company locale + "untranslated" marker).
- [x] `translations.ts` gains `timelineStatus*` / `timelineOutcome*` keys and `timelineTaskCountOne` / `timelineTaskCountOther`. `department.none` (pre-existing) covers the empty-list fallback.
- [x] Deterministic blocked reasons use a bilingual `BLOCKED_REASON_TEXT` table in `packages/core/src/ceoOffice.ts` — `runtimeText`/`localizedRuntimeText.ts` lives in `apps/server` and core cannot import it, so an in-core equivalent is used with a cross-reference comment. Agent-authored strings are wrapped in the company locale (`companyLocaleText`); an already-authored `LocalizedText` (the outcome summary) passes through untouched so a missing company locale stays visible.
- [x] `formatTimelineTasks` takes `tasksById` and renders task titles for dependency, blocked, affected, and completed-task references; the count fallback (`{count} task` / `{count} tasks`) is localized. `formatTimelineDependencies` was folded into `formatTimelineTasks` (it had become a pure alias).
- [x] Tests: core projection wraps reasons/labels under the company locale and keeps an English-only outcome summary un-marked-as-translated for a `zh` company; dashboard timeline renders status/outcome as business language (no raw `snake_case`), renders task references as titles, and shows the "untranslated" marker for a reason missing the company locale.

**Implementation note:** No redesign of the `WaitState` or blocked-issue data models. No historical backfill — a migration fallback (show the raw string until re-authored) is acceptable for old rows.
