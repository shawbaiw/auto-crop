# 07: Outcomes view shows the brief next to the outcome, and marks what's new

**What to build:** The founder can read each Outcomes entry as "you asked for X → here's what came back," and can see at a glance whether anything is new. Each Outcomes entry additionally shows the task's original description/objective next to its Task Outcome Summary (the 4-part Task Outcome Summary contract is unchanged — this is display only, pulling `task.description` already in state). A quiet "N new outcomes since your last visit" marker sits on the Outcomes view, and unseen state is shown on the Final Founder Report banner and on `goal_stage_change` rollups, all computed against a per-company last-seen timestamp in `localStorage`. Storage reads/writes are wrapped so a private window or cleared storage degrades to "nothing new" rather than erroring.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Each Outcomes entry renders the task description/objective alongside its Task Outcome Summary.
- [x] A per-company `localStorage` last-seen timestamp, written on view; a "N new outcomes since your last visit" marker on the Outcomes view derived from it.
- [x] Unseen affordance on the Final Founder Report banner and on `goal_stage_change` rollups from the same last-seen value.
- [x] All `localStorage` access wrapped in try/catch; absent/blocked storage renders "nothing new" and does not throw.
- [x] Tests — Seam 3 (`App.test.tsx`): entries show the description beside the summary; the marker reflects a stubbed last-seen value and clears after a visit; with no/blocked storage nothing-new is shown and no error is thrown.

## Implementation notes

Frontend-only, all in `apps/dashboard/src`.

- **New helper module `ui/ceoOutcomes/lastSeen.ts`** — `readOutcomesLastSeen(companyId)` / `writeOutcomesLastSeen(companyId, iso)` keyed `auto-crop.ceoOutcomesLastSeen.<companyId>`, plus `isUnseenSince(iso, lastSeen)`. Every access (including reading `window.localStorage` itself) is wrapped in try/catch and guarded by `typeof window === "undefined" || !window.localStorage`; a read failure returns `null` ("nothing new"), a write failure is swallowed. Deliberately more defensive than the existing `App.tsx` / `LanguageProvider.tsx` helpers, per this issue.
- **`ui/ceoOutcomes/UnseenBadge.tsx`** — small composition component (`RetroBadge tone="signal"`, text `department.unseenBadge`) that renders nothing unless `iso > lastSeen`. Reused by the report banner and the objective rollup.
- **`DepartmentWorkspace.tsx`** — `CeoIntakeWorkspace` now takes `companyId`; a `useEffect` keyed on it reads the prior last-seen into state, then records the visit (`new Date().toISOString()`). The old value flows down to `CeoOutcomesView` (brief line under each `<h5>` from `task.descriptionText`/`.description`; "N new outcomes" marker under the note, counting *every* `hasOutcomeSummary` completion event newer than last-seen via the shared `isUnseenSince` helper — not just the 12-row recent slice that renders — suppressed when last-seen is `null`), `FinalFounderReportPanel` (`UnseenBadge` on `report.createdAt`), and `CeoExecutiveOverview` (`UnseenBadge` on each `goal_stage_change` rollup's `createdAt`).
- **`translations.ts`** — `department.ceoOutcomesNewMarker` (`{count}` interpolation via `.replace`), `department.outcomeBriefLabel`, `department.unseenBadge`; en + zh.
- **`styles.css`** — three small rules for `.ceo-outcome__brief` / `__brief-label` / `.ceo-outcomes-view__new-marker`; no new styling system.
- **Tests** — `App.test.tsx` Seam 3: brief beside summary; "2 new outcomes" against a stubbed last-seen and cleared after a remount/re-read; count reflects every unseen outcome (15) not the 12-row slice; nothing-new + no throw when `window.localStorage` is absent and when the last-seen read throws; unseen badge on the report banner and objective rollup. `npm run typecheck` and `npm test` (463 tests) green.

Post-review tweaks (from `/code-review`): the marker count now goes through the shared `isUnseenSince` helper and the pre-slice list (fixes a "capped at 12" undercount); `taskBrief` is bound once per event; `UnseenBadge`'s prop is `createdAt`, not `iso`.
