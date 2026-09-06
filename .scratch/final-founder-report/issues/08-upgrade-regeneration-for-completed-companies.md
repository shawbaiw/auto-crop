# 08: Existing completed companies get a report once, on upgrade

**What to build:** A founder returning to a company that finished before this feature shipped gets its closing report generated once, without re-running any task. On the scheduler tick, alongside the existing ADR 0017 review reconciliation, a one-time per-company pass: for a company that is quiescent, has every task `complete`, and has no Final Founder Report, enqueue exactly one report generation job (which reads the accepted Business Artifacts that already exist, and falls back deterministically if the agent run fails). A per-company marker makes every later tick a no-op. Companies with blocked/stalled tasks are left alone (they get a normal report on their next quiescent tick); companies that already have a report are untouched; no per-task Task Outcome Summaries are synthesized for old tasks.

**Blocked by:** 02, 03.

**Status:** done

- [x] One-time reconciliation pass on the tick: quiescent + all tasks `complete` + no report → enqueue one generation job.
- [x] Per-company marker (reuse the review-reconciliation marker pattern) makes re-runs no-ops.
- [x] Skips companies with any non-`complete` task and companies that already have a report.
- [x] No per-task backfill.
- [x] Tests — Seam 1 (`scheduler.test.ts`): a pre-existing all-`complete` report-less company gets exactly one report on the first tick; a second tick produces no duplicate; a company with a blocked task and a company with an existing report are untouched; when the agent fails the upgrade path still yields a `deterministic_fallback` report.

**Implementation notes:**
- `reconcileFinalFounderReportUpgrade` in `scheduler.ts` runs in the top-of-tick per-company loop right after `reconcileReviewTasksForAutomaticAcceptance`. Marker: `final_founder_report_upgrade_v1:<companyId>` in `runtime_state` via new `hasFinalFounderReportUpgradeRun` / `markFinalFounderReportUpgradeRun` repository methods (same `ON CONFLICT DO NOTHING` pattern as the review-reconciliation marker). The marker is recorded on every first examination of a company, so a company that is still running when the pass first sees it is marked and thereafter handled by `maybeEnqueueFinalFounderReportJob` on its next quiescent tick.
- The pass enqueues a `preparing` `founder_report_jobs` row (never runs the CEO Agent); `runFinalFounderReportJobs` authors it off the tick via the existing `generateFinalFounderReport` (retry + deterministic fallback). It reuses `gatherFinalFounderReportContext` for the quiescence check and dedupes against a standing report or in-flight job, so it and the end-of-tick `maybeEnqueueFinalFounderReportJob` never double-enqueue.
