# Localized Business Content

Auto-Crop will treat department names, department responsibilities, objective titles, task titles, task descriptions, progress labels, and system activity messages as Localized Business Content, not as raw English strings that the dashboard translates opportunistically. Static UI chrome remains translation-key based, while business content created from playbooks, runtime templates, or agent-authored blueprints must carry either stable localization keys or per-locale values so the dashboard can render the active Interface Locale coherently.

Considered alternatives were frontend-only translation of displayed strings, storing only the language used at company creation time, and requiring agents to emit only the current language. Frontend-only translation is brittle because persisted task text, event text, and generated summaries have no stable semantic identity; creation-time language prevents later locale switching from being coherent; current-language-only agent output works for one view but cannot satisfy the requirement that switching English and Chinese changes all Auto-Crop-authored content.

Raw source content remains raw: user-provided company names, Founder Vision text, CEO Intake text, URLs, file paths, command output, and agent brand names such as Codex or Claude Code are not translated merely because the Interface Locale changes. Agent-produced proof summaries, failure messages, and review notes should expose localized dashboard summaries when Auto-Crop presents them as product UI; the original agent output can remain available as evidence or diagnostic source content.

## Extension (2026-09-10): Single Canonical Locale For Generated Content

The bilingual `{ en, zh }` authoring contract this ADR originally established for agent-authored content is superseded, for founder-facing **generated** content, by a single canonical locale per company. This is the correct model for a single-founder-per-company product: it removes "which locale did the agent skimp on" as a failure mode and matches the fact that one founder reads one language.

- A `Company.locale` (`"en" | "zh"`) is set once at company creation and is the language all generated founder-facing prose is authored in. Existing companies default to `"en"` with no deep migration (ADR 0015 precedent).
- Every founder-facing authoring agent is told that locale and writes founder-facing prose only in it: **task execution** (Structured Execution Report fields, `outcome_summary`, every Open Decisions `label` / `tradeoffs` / `recommendation` / `rationale` / `briefing`) and the **Final Founder Report** (every section value). The Execution Report parser stores a bare agent string under `Company.locale` rather than always `en`.
- The **CEO blueprint path is unchanged** — `ceoPrompt.ts` stays bilingual and its validation is untouched.
- Machine identifiers, file paths, URLs, code, and brand names are exempt from translation everywhere.
- A founder-facing localized field that lacks the company-locale value renders with a visible "未翻译 / untranslated" marker and is logged. It is **not** a structural validation failure and never blocks task completion, acceptance, or the business flow. There is no machine-translation or backfill layer — the visible marker is the whole behavior.
- The dashboard Interface Locale toggle still switches UI chrome (`translations.ts`) freely. It no longer implies that generated business narrative can switch, because that narrative is authored in one language.
