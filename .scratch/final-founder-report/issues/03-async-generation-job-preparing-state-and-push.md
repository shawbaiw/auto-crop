# 03: Report generation is an async tracked job, with a "preparing" state, pushed live

**What to build:** Report generation stops blocking the scheduler tick, and the founder sees the report arrive live. When a company goes quiescent, the runtime enqueues a **tracked async generation job** (modelled on an Agent Run) instead of generating inline. Between the trigger and a finished report, the Company State Snapshot exposes a "report preparing" indicator and CEO Office shows a preparing state in the pinned panel. When the report record becomes `isCurrent`, the runtime publishes a new `company_report_ready` SSE event through the existing event stream; the dashboard registers that event and refetches the Company State Snapshot, so the panel flips from "preparing" to the report without a manual reload.

**Blocked by:** 01.

**Status:** done

- [x] Report generation moves from inline-in-tick to a tracked async job with its own status record; the tick enqueues and returns.
- [x] Company State Snapshot exposes a "report preparing" indicator derived from an unfinished generation job, distinct from "no report".
- [x] New `company_report_ready` SSE event published through the existing `EventStream` when a report becomes `isCurrent`.
- [x] Dashboard event client registers `company_report_ready` and triggers a state refetch on it.
- [x] CEO Office pinned panel shows a preparing state when the indicator is set and no `isCurrent` report exists yet.
- [x] Tests — Seam 1 (`scheduler.test.ts`): a quiescent company creates a generation job and the tick does not block on the agent run; on job completion a `company_report_ready` event is emitted.
- [x] Tests — Seam 2 (`routes.test.ts`): the snapshot shows the "preparing" indicator during the gap and clears it once the report exists.
- [x] Tests — Seam 4 (`client.test.ts`): the client registers a `company_report_ready` listener and invokes the refetch path on that event.
- [x] Tests — Seam 3 (`App.test.tsx`): the panel renders the preparing state from the indicator.

**Implementation notes:**
- `founder_report_jobs` table (company-keyed: `status` `preparing`/`complete`/`failed`, timestamps, `failure_message`) via `CREATE TABLE IF NOT EXISTS` in `migrate()` — no ALTER. Core type `FinalFounderReportJob` + `FinalFounderReportJobStatus`.
- `runSchedulerOnce`'s quiescence sweep now calls `maybeEnqueueFinalFounderReportJob` (creates a `preparing` row and returns — no CEO Agent run). A new exported `runFinalFounderReportJobs` authors the report for each `preparing` job via the existing `generateFinalFounderReport` (retry + deterministic fallback), marks the job `complete`, and emits `company_report_ready` (a company-scoped `SchedulerEvent`, `taskId` now optional). `startSchedulerLoop` fire-and-forgets `runFinalFounderReportJobs` after each tick behind a single-runner guard so a slow CEO run never stalls task dispatch.
- Shared `gatherFinalFounderReportContext` derives quiescence + a lazy `buildGenerateInput` for both the enqueue check and the job runner. A job whose company is no longer quiescent when it runs is marked `failed`; the next quiescent tick re-enqueues.
- `buildCompanyState` adds `finalFounderReportPreparing` (`getActiveFinalFounderReportJob(companyId) !== null`). Dashboard: `FinalFounderReportPanel` renders a preparing RetroPanel when `preparing && !report`; `subscribeEvents` registers `company_report_ready`; `shouldReloadCompanyStateAfterEvent` refetches on it.
