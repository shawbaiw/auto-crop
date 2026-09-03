# 06: Upgrade reconciliation

**What to build:** When this change ships to an existing company, the founder is not left with a queue of tasks the new model would have accepted. A one-time, idempotent pass re-evaluates every task currently sitting in `review` against the deterministic acceptance conditions and clears the ones that qualify. It fabricates no history: already-`complete` tasks are untouched and no Task Outcome Summary is synthesized for them.

Governing decision: `docs/adr/0017-ceo-office-surfaces-business-outcomes.md`. Spec: `.scratch/ceo-office-business-outcomes/spec.md`.

**Blocked by:** 01 (Deterministic Automatic Acceptance), 03 (Founder Decision — declaration and acceptance gating)

**Status:** ready-for-agent

- [ ] A reconciliation routine re-evaluates every task currently in `review` against the deterministic acceptance conditions.
- [ ] Tasks that qualify are accepted through the shared business acceptance path with `acceptanceProvenance = automatic_acceptance` and no `outcomeSummaryText`.
- [ ] Tasks that declare a kept Founder Decision, or whose text trips the risk-pattern scan, stay in `review` for manual handling.
- [ ] Tasks that are `complete` or `blocked` are not touched; no summary or Task Completion Event is synthesized for already-`complete` tasks.
- [ ] The pass is idempotent: running it again after a first run accepts nothing further and changes no state.
- [ ] The known stuck company is skipped, following the ADR 0015 precedent.
- [ ] Tests at the task business acceptance seam covering accept-once, idempotent re-run, and the skip cases — following existing prior art.
