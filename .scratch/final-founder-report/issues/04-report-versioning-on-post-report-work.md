# 04: A new report supersedes the old one when work runs after a report

**What to build:** A founder who keeps iterating gets a fresh checkpoint each time the company settles. After a Final Founder Report exists, if non-Wait-State work runs and completes (a replan, a recovered task, or — later — CEO-Intake-driven tasks) and the company returns to quiescence, the runtime generates a new report: the previous `founder_reports` record is set non-current, the new one is `isCurrent` with `supersedesReportId` pointing at the old one. A bare Wait State check-in that changes nothing does **not** trigger a new report. The Company State Snapshot serves the current report and keeps prior ones available as a non-current list.

**Blocked by:** 03.

**Status:** done (landed in 3c380c8)

- [x] Supersession trigger: quiescent + an `isCurrent` report exists + non-Wait-State work has completed since that report was created.
- [x] A Wait State check-in that re-queues nothing / changes nothing does not count as new work.
- [x] New report generation sets the prior record non-current and records `supersedesReportId`.
- [x] `buildCompanyState` serves the `isCurrent` report and exposes the non-current reports (list or count) so history is visible.
- [x] Tests — Seam 1 (`scheduler.test.ts`): after a report, completing a new task drives re-quiescence and a second report; first record non-current, second `isCurrent` with `supersedesReportId` set; a lone Wait State check-in that changes nothing produces no second report.
- [x] Tests — Seam 2 (`routes.test.ts`): after supersession the response's report is the new one and the non-current list contains the old one.

**Implementation notes:**
- Supersession signal is `hasWorkCompletedSinceReport` in `finalFounderReport.ts`: any Task Completion Event with `createdAt` strictly after the current report's `createdAt`. A bare Wait State check-in re-queues a task without recording a completion event, so it does not trip. Both `maybeEnqueueFinalFounderReportJob` and `runFinalFounderReportJobs`' "report already exists" guard now allow a fresh job when this predicate is true.
- `generateFinalFounderReport` reads the standing `isCurrent` report before the insert and stamps `supersedesReportId`; `createFinalFounderReport` already flips the prior record non-current.
- `buildCompanyState` adds `supersededFinalFounderReports` (non-current reports, oldest first, via `summarizeFinalFounderReport`); the summary now also carries `supersedesReportId` and `createdAt`. Dashboard `FinalFounderReportSummary` / response types updated to match; no new UI panel (history is exposed on the snapshot only).
