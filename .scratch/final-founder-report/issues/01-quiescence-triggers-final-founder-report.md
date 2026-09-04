# 01: Company quiescence triggers a Final Founder Report shown in CEO Office

**What to build:** When every task in a company has finished and the runtime has no forward move left, the founder gets a closing report. The runtime detects **Company Quiescence** — no task `queued`, `running`, or `waiting_dependency`; no Wait State checking in within the near horizon; every remaining task terminal (`complete`, or `blocked`/`retry_exhausted` with no path back to `queued`) or parked on a Human Action or Founder Decision. On the first quiescent tick with no existing report, the runtime runs the company's selected CEO Agent to author a **Final Founder Report**: the original Founder Vision, the actual result in plain language, each department's inputs and outputs, goal fit against objectives and key results, remaining Vision Gaps, and a recommended next step — classified `achieved` (key results met), `stalled` (terminally blocked, goals unmet), or `waiting` (only open items are Wait States beyond the horizon, Human Actions, or Founder Decisions). A company quiescent only because its Wait States check in beyond the horizon still gets a report; its recommended-next-step names each pending Wait State and its `nextCheckAt`. The report is persisted as a company-keyed `founder_reports` record (not a Business Artifact — that table is task-bound). The Company State Snapshot serializes the `isCurrent` report, and CEO Office renders it as a panel pinned above the Outcomes view with the classification prominent.

Generation is synchronous in the tick for this ticket; the async job, "preparing" state, and live push come in ticket 03; the failure fallback comes in ticket 02.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Core: `finalFounderReportClassification` union (`achieved` | `stalled` | `waiting`) + zod schema; `FinalFounderReport` type + zod schema (id, companyId, classification, six localized-text sections, `generatedBy`, `isCurrent`, `supersedesReportId`, timestamps).
- [ ] `founder_reports` table + migration + repository create/read (current report for company, list for company).
- [ ] Quiescence predicate over a company's tasks and projected Wait States, evaluated on the scheduler tick after task state has settled.
- [ ] Classification derived from key-result status, terminally-blocked tasks, and the set of open Wait States / Human Actions / Founder Decisions.
- [ ] Report generation: build a prompt from the spec's listed inputs, run the selected CEO Agent via the same session-manager path as `generateCompanyBlueprint` in the company workspace, parse a structured report payload from stdout, persist as an `isCurrent` `founder_reports` record with `generatedBy: ceo_agent`.
- [ ] `buildCompanyState` serializes the `isCurrent` Final Founder Report (sections + classification + `generatedBy`).
- [ ] CEO Office renders a Final Founder Report panel pinned above Outcomes when an `isCurrent` report exists, classification prominent, sections shown, using existing retro primitives; localized text rendered in the active Interface Locale.
- [ ] Tests — Seam 1 (`scheduler.test.ts`): all-`complete` company becomes quiescent and gets a report; a `queued`/`waiting_dependency` task means no report; near-horizon Wait State means not quiescent, beyond-horizon means `waiting` classification; terminally blocked + unmet key results means `stalled`; all key results met means `achieved`.
- [ ] Tests — Seam 2 (`routes.test.ts`): company-state response serializes an `isCurrent` report with classification and all six sections.
- [ ] Tests — Seam 3 (`App.test.tsx`): the pinned panel renders above Outcomes with classification and sections.
- [ ] Tests — Seam 5 (`schemas.test.ts`): each classification value parses; a well-formed report payload parses; one missing a required section does not.
- [ ] Tests do not pin the exact near-horizon constant, only the two sides of the boundary.
