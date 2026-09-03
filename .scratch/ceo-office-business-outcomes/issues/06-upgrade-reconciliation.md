# 06: Upgrade reconciliation

**What to build:** When this change ships to an existing company, the founder is not left with a queue of tasks the new model would have accepted. A one-time, idempotent pass re-evaluates every task currently sitting in `review` against the deterministic acceptance conditions and clears the ones that qualify. It fabricates no history: already-`complete` tasks are untouched and no Task Outcome Summary is synthesized for them.

Governing decision: `docs/adr/0017-ceo-office-surfaces-business-outcomes.md`. Spec: `.scratch/ceo-office-business-outcomes/spec.md`.

**Blocked by:** 01 (Deterministic Automatic Acceptance), 03 (Founder Decision — declaration and acceptance gating)

**Status:** done

- [x] A reconciliation routine re-evaluates every task currently in `review` against the deterministic acceptance conditions.
- [x] Tasks that qualify are accepted through the shared business acceptance path with `acceptanceProvenance = automatic_acceptance` and no `outcomeSummaryText`.
- [x] Tasks that declare a kept Founder Decision, or whose text trips the risk-pattern scan, stay in `review` for manual handling.
- [x] Tasks that are `complete` or `blocked` are not touched; no summary or Task Completion Event is synthesized for already-`complete` tasks.
- [x] The pass is idempotent: running it again after a first run accepts nothing further and changes no state.
- [x] The known stuck company is skipped, following the ADR 0015 precedent.
- [x] Tests at the task business acceptance seam covering accept-once, idempotent re-run, and the skip cases — following existing prior art.

**Implementation notes:**

- `reconcileReviewTasksForAutomaticAcceptance` (`apps/server/src/runtime/reviewReconciliation.ts`) is the runtime pass. It is wired into the per-company loop in `runSchedulerOnce` and into `buildCompanyState`, mirroring how `reconcileStaleRunningTasks` is called from both. The scheduler runs a tick every few seconds, so on ship the pass runs within seconds with no dedicated startup hook.
- No one-shot marker in `runtime_state`. The pass is naturally idempotent (an accepted task leaves the `review` filter; a task left in `review` re-fails the same check) and cheap (a handful of `review` tasks, one regex scan each), so re-running it every tick is not worth a stored flag and the extra read/write repository methods it would need.
- No company allow/deny list and no company-id constant. Following the ADR 0015 precedent, the pass treats every company alike; the known stuck company's problem tasks are `blocked`/`failed`, never `review`, so they are skipped by construction.
- `acceptTaskBusinessArtifact` gained an `outcomeSummaryText?: LocalizedText | null` passthrough to `recordTaskCompletionEvent` (the comment there already anticipated it). The reconciliation passes `null`; every existing caller omits it and is unchanged.
