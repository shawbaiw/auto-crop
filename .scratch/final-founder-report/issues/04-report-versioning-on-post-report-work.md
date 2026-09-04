# 04: A new report supersedes the old one when work runs after a report

**What to build:** A founder who keeps iterating gets a fresh checkpoint each time the company settles. After a Final Founder Report exists, if non-Wait-State work runs and completes (a replan, a recovered task, or — later — CEO-Intake-driven tasks) and the company returns to quiescence, the runtime generates a new report: the previous `founder_reports` record is set non-current, the new one is `isCurrent` with `supersedesReportId` pointing at the old one. A bare Wait State check-in that changes nothing does **not** trigger a new report. The Company State Snapshot serves the current report and keeps prior ones available as a non-current list.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] Supersession trigger: quiescent + an `isCurrent` report exists + non-Wait-State work has completed since that report was created.
- [ ] A Wait State check-in that re-queues nothing / changes nothing does not count as new work.
- [ ] New report generation sets the prior record non-current and records `supersedesReportId`.
- [ ] `buildCompanyState` serves the `isCurrent` report and exposes the non-current reports (list or count) so history is visible.
- [ ] Tests — Seam 1 (`scheduler.test.ts`): after a report, completing a new task drives re-quiescence and a second report; first record non-current, second `isCurrent` with `supersedesReportId` set; a lone Wait State check-in that changes nothing produces no second report.
- [ ] Tests — Seam 2 (`routes.test.ts`): after supersession the response's report is the new one and the non-current list contains the old one.
