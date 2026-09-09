Status: ready-for-agent

# CEO Office Broadcast Timeline

Governing decisions: `docs/adr/0019-ceo-office-unified-information-layer.md` (amended here) and `docs/adr/0013-localized-business-content.md` (extended here). Builds directly on the CEO Office Unified Information Layer work (`.scratch/ceo-office-unified-information-layer/`, complete).

## Problem Statement

The founder set the interface to Chinese, opens CEO Office, and the timeline still reads in mixed Chinese and English. The mixing is not in the UI chrome — that is fully translated — it is in the agent-authored business prose: Execution Report fields, Founder Decision `rationale` / option labels / trade-offs, and a batch of internal codes (`outcome`, `status`, `decisionKind`, wait/blocked reasons) rendered raw. The dashboard language is a client-only `localStorage` toggle; the server and every agent have no idea what language the founder chose. The CEO blueprint agent and the Final Founder Report agent are already told to author bilingual `{en, zh}` content and are validated on it; the task-execution agent is the only founder-facing author that was never brought into that contract, and its parser (`normalizeLocalizedReportField`) fills only the `en` slot from a bare string.

Two more things are wrong with the timeline itself. Every CEO Office Item renders as an always-expanded 3–7 row key-value table, so the point of each item is buried under scaffolding (purpose-source label, founder vision repeated on every card, metric name, target value, dependency task IDs shown as raw IDs). And `projectCeoOfficeItems` emits an `execution_report` for every `TaskCompletionEvent` regardless of `outcome`, so a task that is `blocked`, `needs_replan`, or `awaiting_founder_decision` — work the founder does not consider finished — still shows an "Execution Report" card.

Separately, while drilling in: the `assessment_complete` progress event carries no detail, so the Task Brief's "purpose" always falls back to the raw task description and the brief is effectively just the task description with a scaffold around it.

## Solution

CEO Office reads as a broadcast station. When a department picks up a task it broadcasts a one-line **Brief** ("Research dept · Task 1 · Research and select the first SEO keyword opportunity"). When a task finishes it broadcasts a **Report**: the conclusion, what it means for the Founder Vision, the remaining gap, and the recommendation. When a completed task leaves a strategic choice for the founder it also broadcasts a **Decision** card carrying enough context to decide — what was explored, where the opportunity is, what is differentiated, the monetization angle and why, the options with trade-offs, and the recommendation. Cards arrive newest-at-bottom and push history up, exactly like an agent's execution-step feed; each card is a summary and clicking it opens the full detail in a modal.

Everything the founder reads is in the one language the company was created with. A new `Company.locale` is the canonical content language. Every founder-facing authoring agent — task execution and Final Founder Report — is told that locale and writes founder-facing prose only in it. The dashboard language toggle keeps switching the UI chrome; it no longer implies that generated business narrative can switch, because it is authored in one language. When a required field comes back missing the company locale, the UI shows a visible "untranslated" marker rather than silently falling back to English, and the business flow is not blocked.

## Decisions Locked

1. **Generated-content language model: single canonical locale per company.** Not bilingual. `Company.locale` is set once at creation and is the language all generated founder-facing prose is authored in. The CEO blueprint prompt is out of scope for this change (it stays as-is); the Final Founder Report prompt moves to single-locale authoring. UI chrome (`translations.ts`) stays fully switchable.
2. **Missing-locale behavior: visible fallback marker.** A founder-facing localized field that lacks the company-locale value renders with a visible "未翻译 / untranslated" marker and is logged. It is not a structural validation failure and does not block task completion or acceptance.
3. **"View task detail": modal, v1.** Clicking a timeline card opens a modal with that item's full data plus evidence. No new task-detail route. The existing `ceo-task-review-detail` panel and its collapsed evidence section are the model for what the modal shows.
4. **"Brief" (说明) semantics: the Decision card is the post-task substance surface.** It is an enriched `decision_request`, not a new CEO Office Item type. A completed task with no strategic decision produces only a Report, never a Decision card. The pre-execution Task Brief is demoted to a one-line announcement.
5. **`execution_report` is projected only when `outcome === "accepted"`.** Non-accepted completion events are represented by their exception card (`blocked_issue`, or the `decision_request` for `awaiting_founder_decision`), not by a misleading Report.

## User Stories

1. As a founder who chose Chinese, I want every Execution Report, Decision card, and status label in the timeline to be in Chinese, so that CEO Office reads as one language.
2. As a founder, I want the language I pick at company creation to be recorded on the company, so that agents author content in it instead of guessing.
3. As a founder, I want the task-execution agent held to the same language contract as the blueprint and final-report agents, so that task outputs are not the one place English leaks in.
4. As a founder, when an agent fails to provide my language for a field, I want the UI to show a clear "untranslated" marker, so that I know it is a gap and not the intended content — without the task getting stuck.
5. As a founder, I want the dashboard UI chrome to still switch between English and Chinese, so that changing interface language keeps working for labels and navigation.
6. As a founder, I want each completed task to broadcast a Report with the conclusion, what it means for the vision, the remaining gap, and the recommendation, so that I understand the result without opening the artifact.
7. As a founder, I want a task that leaves a strategic choice to broadcast one Decision card with the options, their trade-offs, the recommendation, the rationale, and a briefing of what was explored and why these options exist, so that I can decide from that card alone.
8. As a founder, I want a completed task with no strategic choice to broadcast only a Report and never a Decision card, so that routine work does not ask for my input.
9. As a founder, while a task is waiting on my decision, I want to see only the Decision card and not an Execution Report, so that I am not shown a "report" for work that is not accepted yet.
10. As a founder, after I resolve a decision, I want the Report and a Decision Resolution to appear in the timeline as history, so that the sequence stays readable.
11. As a founder, I want the pre-execution Brief to be a single readable line — task, purpose, objective, what it depends on — so that it announces the task without a wall of fields.
12. As a founder, I want dependency and affected-task references shown as task titles, never as raw IDs, so that the timeline is readable.
13. As a founder, I want the founder vision shown once in the company-state header, not repeated on every Brief card, so that cards carry only what is specific to them.
14. As a founder, I want timeline cards to be summaries I can click to expand, arriving newest-at-bottom and pushing history up, so that CEO Office reads like an agent's step feed.
15. As a founder, I want action-bearing cards (decision, approval, blocked) to look visually distinct from routine cards (report, stage change, resolution), so that what needs me stands out.
16. As a founder, I want internal codes — completion outcome, item status, decision kind, wait and blocked reasons — never shown raw, so that the timeline is business language, not database state.
17. As a founder, I want clicking a card to open a modal with the full item detail and its evidence, so that I can inspect without leaving the timeline.
18. As a developer, I want `Company.locale` threaded through the task-execution prompt and the Execution Report parser, so that a bare string is stored under the right locale key.
19. As a developer, I want the Execution Report field structure unchanged (`conclusion`, `visionImpact`, `remainingGap`, `recommendation`), so that only the normalization default changes.
20. As a developer, I want `briefing` added to the `open_decisions` contract and the `FounderDecision` model — type, zod, DB column, migration, repository mapping, projection, serialization — so that the Decision card has substance to render.
21. As a developer, I want `execution_report` projected only for `accepted` completion events, so that the two completion events a founder-decision resolution produces collapse to the accepted one with no dedup code.
22. As a developer, I want enum and runtime-string localization handled with locale-aware formatters and the existing `runtimeText` / translation-key helpers, so that no new data model is needed for wait/blocked reasons.
23. As an operator upgrading an existing company, I want existing companies to default to `locale: "en"` with no deep migration, so that the upgrade is safe (ADR 0015 precedent).
24. As a maintainer, I want ADR 0019 amended to record that the Task Brief is a one-line announcement, the Decision card is the post-task substance surface, and Execution Reports are projected only for accepted outcomes.

## Implementation Decisions

### Company locale

- Add `Company.locale: Locale` (`"en" | "zh"`) — core type, zod schema, DB column, migration defaulting existing rows to `"en"`, repository mapping, `summarizeCompany` serialization.
- The creation API and `CreateCompanyInput` gain `locale`. The CEO intake UI adds a language selector (or captures the current `LanguageProvider` value at submit time).
- The dashboard initializes `LanguageProvider` from `company.locale` when a company loads. The toggle still works for chrome afterward.
- No language detection from Founder Vision text. No post-creation locale change in v1. No per-department or per-task locale.

### Task-execution prompt

- `buildTaskExecutionPrompt` injects the company locale into `## Company Context`.
- The "Structured Execution Report" and "Open Decisions" sections are rewritten: all founder-facing prose (`execution_report` fields, `outcome_summary`, every `open_decisions` `label` / `tradeoffs` / `recommendation` / `rationale` / `briefing`) must be authored in the company language. Machine identifiers, file paths, URLs, code, and brand names stay as-is. The "may be a string or `{en, zh}` object" language is removed.
- JSON example values in the prompt are localized to match the instruction.
- The CEO blueprint prompt (`ceoPrompt.ts`) is not touched.

### Execution Report

- Field structure unchanged: `conclusion`, `visionImpact`, `remainingGap`, `recommendation`, each `LocalizedText`.
- `parseExecutionReportInput(input, locale)` — a bare string normalizes to `{ [locale]: value }` instead of `{ en: value }`. A `{en, zh}` object is accepted as-is. Locale is threaded from `taskCompletion.ts` and `businessArtifact.ts`, both of which have the company.
- Validation (`executionReportFieldError`) requires the company-locale value to be non-empty on `deliverable` / `final_report`. It does not require both locales.
- `outcome_summary` stays as the compatibility fallback for older companies.

### Founder Decision `briefing`

- Add `briefing: LocalizedText` to `FounderDecisionDeclaration`, `FounderDecisionOption`'s parent entry, and `FounderDecision` — core types, zod schemas, DB column, migration, repository mapping.
- `parseKnownEntry` validates `briefing` is present and non-empty for a kept entry, on the same footing as `rationale`.
- `label`, `tradeoffs`, `rationale`, `briefing` are authored in the company locale and stored as `LocalizedText[locale]`.
- The projection's `decision_request` data carries `briefing`. Routes serialization and `CeoOfficeItemSummary` include it. The dashboard Decision card leads with the briefing; options and rationale are secondary.
- No change to the resolution API (`POST /founder-decisions` pick / return). No structured sub-fields inside `briefing` in v1. No change to `decisionKind`.

### Task Brief demotion

- The `task_brief` CEO Office Item keeps its `data` shape (or trims `keyResultMetricName` / `keyResultTargetValue` — optional). The dashboard renders it as: task title + one-sentence purpose (`task.descriptionText`, company locale) + objective / key result on one line + dependency **task titles**. Everything else moves into the click-to-expand modal.
- Founder vision moves to the company-state header, shown once.
- No change to `scheduler.ts` (the assessment step still does not produce prose — deferred, per ADR 0019). No removal of `task_brief`. No change to `task_brief` `occurredAt`.

### Timeline UI

- Card = summary: type tag + department + relative time + title + one key line (the conclusion / the reason / the purpose / the decision ask). Click opens a modal with the full `VideotexKeyValue` detail, options, evidence, and a "查看任务详情" affordance.
- Type tag carries semantic weight: `decision_request` / `approval_request` / `blocked_issue` render as action-state (accent stripe); `execution_report` / `stage_change` / `decision_resolution` / `final_report` render quiet.
- Every raw-enum render is replaced by a locale-aware formatter or translation key: `formatCompletionOutcome`, `formatTimelineStatus` (→ keys), `formatDecisionKind` (already exists), human-action label, wait/blocked reason.
- `formatTimelineDependencies` and `formatTimelineTasks` take `tasksById` and render titles; the hardcoded `"N tasks"` fallback is localized.
- Cards keep ascending (oldest-first) sort. A newly arrived card briefly highlights, gated by `prefers-reduced-motion`.
- The `line()` helper shows the visible "untranslated" marker when the company-locale value is absent.
- The Outcomes / CEO Pending / Attention sections stay (ADR 0019: consolidate only after multi-scenario coverage is proven).

### Projection: accepted-only reports

- `projectCeoOfficeItems` emits `execution_report` only when `event.outcome === "accepted"`.
- `blocked` / `needs_replan` / `failed_to_review` are represented by `blocked_issue`; verify `blocked_issue` covers the `failed_to_review` completion outcome and add it if not.
- `awaiting_founder_decision` is represented by the `decision_request` card. When the founder resolves and the shared acceptance seam records a second, `accepted` completion event, the filter naturally renders only that one — no dedup logic.
- `timelineOrder` already places `execution_report` before `decision_request`; unchanged.

### Enum / runtime-string localization

- Enum-class values (`outcome`, `status`, `decisionKind`) get dashboard-side locale-aware formatters plus `translations.ts` keys.
- Runtime-generated strings (wait-state detail, blocker reason) follow the same locale strategy as the execution prompt, using the existing `localizedRuntimeText.ts` helpers (`runtimeText(en, zh)` for deterministic ones).
- No redesign of the `WaitState` or blocked-issue data models. No historical backfill.

## Testing Decisions

Good tests assert externally observable outcomes: stored locale on the company, the locale key a bare Execution Report string lands under, the presence of the visible untranslated marker when a locale value is missing, projected `execution_report` items filtered by outcome, `briefing` present on the projected `decision_request` and in company-state serialization, dependency references rendered as titles, and the modal opening with full detail. Prefer feeding a Business Artifact through the real completion + acceptance path over unit-testing the parser in isolation.

- Creating a company with `locale: "zh"` stores it; `summarizeCompany` returns it; an existing company with no locale reads back as `"en"`.
- A task-execution prompt built for a `zh` company contains the Chinese-authoring instruction and localized JSON examples.
- An Execution Report submitted as a bare Chinese string is stored as `{ zh: "…" }` and renders without the untranslated marker in the Chinese UI; a bare string on an `en` company stores as `{ en: "…" }`.
- An Execution Report missing the company-locale value renders with the visible untranslated marker and does not fail validation or block acceptance.
- A `deliverable` whose Execution Report omits the company-locale value on a required field is still accepted (marker is not a validation failure) — but a completely absent `execution_report` still fails validation as today.
- An `open_decisions` entry without `briefing` on a known `decisionKind` is a structural validation failure; with `briefing` it is kept and the projected `decision_request` carries it; company-state serialization includes it.
- A completed task with no `open_decisions` produces an `execution_report` and no `decision_request`.
- A task with outcome `blocked` / `needs_replan` / `failed_to_review` produces no `execution_report`; a `blocked_issue` is present.
- A task that goes `awaiting_founder_decision` then `accepted` via resolution produces exactly one projected `execution_report` (from the accepted event) plus a `decision_resolution`.
- The dashboard timeline renders a card as a summary; the detail table, options, and evidence appear only after the card is activated (modal).
- Dependency and affected-task references in timeline cards render as task titles; no raw IDs; the empty fallback is localized.
- `outcome`, `status`, `decisionKind`, and wait/blocked reasons never render as raw snake_case in the timeline.
- Switching the dashboard language toggle still switches chrome strings; generated Execution Report / Decision prose stays in the company locale.

## Out Of Scope

- Bilingual `{en, zh}` authoring for generated content (rejected in favor of single canonical locale).
- Changing the CEO blueprint prompt (`ceoPrompt.ts`).
- Post-creation locale change; per-department or per-task locale; language detection from Founder Vision.
- A machine-translation / backfill layer to fill a missing locale (visible marker instead).
- A dedicated task-detail route (modal instead).
- Structured `briefing` sub-fields (opportunity / differentiation / monetization as separate keys).
- Making the assessment step produce structured Task Brief fields (deferred, per ADR 0019).
- Consolidating or removing the Outcomes / CEO Pending / Attention sections.
- Historical backfill of localized wait/blocked reasons or Execution Reports for already-complete tasks.
- Migrating the known stuck company.

## Further Notes

This continues ADR 0019's arc: the unified CEO Office Item layer shipped, but the timeline still reads as raw data and mixed language. This spec makes it read as a broadcast feed and fixes the language pipeline the layer inherited.

ADR 0013 established Localized Business Content and brought the blueprint and Final Founder Report agents into a bilingual contract. The task-execution agent was never brought in. Rather than finish the bilingual model, this spec pivots generated content to a single canonical locale per company — the correct model for a single-founder-per-company product, and the one that removes "which locale did the agent skimp on" as a failure mode. The bilingual code in the blueprint path is left alone; only the Final Founder Report prompt moves.

The amendment to ADR 0019: the two-item guarantee (Brief before execution, Report after) stands, but the Brief is a one-line announcement and the Report is projected only for `accepted` outcomes — exceptions are carried by their own card types. The Decision card ("说明") is the post-task substance surface and stands alone while a task awaits the founder's decision.
