# 02: Author Task-Execution Content In The Company Locale

**What to build:** The task-execution agent is told the company's canonical locale and instructed to write all founder-facing prose in it. This closes the one authoring path ADR 0013 never brought into a language contract.

**Blocked by:** 01 (Add Company Canonical Locale)

**Status:** ready-for-agent

- [ ] `buildTaskExecutionPrompt` injects the company locale into `## Company Context` as an explicit "author founder-facing prose in <language>" instruction.
- [ ] The "Structured Execution Report" section requires `conclusion`, `vision_impact`, `remaining_gap`, `recommendation`, and `outcome_summary` to be written in the company language; the "may be a string or `{en, zh}` object" wording is removed.
- [ ] The "Open Decisions" section requires every `open_decisions` `label`, `tradeoffs`, `recommendation`, `rationale`, and `briefing` to be written in the company language.
- [ ] Machine identifiers, file paths, URLs, code, and brand names are explicitly exempt from translation.
- [ ] The JSON example values in the prompt are localized to match the instruction (keys stay English).
- [ ] The CEO blueprint prompt (`ceoPrompt.ts`) is not modified.
- [ ] Tests: a prompt built for a `zh` company contains the Chinese-authoring instruction and Chinese example values; a prompt for an `en` company reads in English.

**Implementation note:** `company` is already in `BuildTaskExecutionPromptInput`. Check `proofContract.ts` for any founder-facing text that should follow the same rule; the proof contract structure itself does not change.
