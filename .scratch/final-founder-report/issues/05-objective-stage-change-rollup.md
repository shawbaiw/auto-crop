# 05: Objective Stage Change — one rolled-up signal per completed objective

**What to build:** While a company is still running, the founder hears from it once per objective instead of once per task. When the last task whose `keyResultId` rolls up to an objective reaches a terminal state, `projectCeoAttention` yields one **Objective Stage Change**: a CEO Attention Rollup with the new reason `goal_stage_change`, grouped by that objective, condensing the objective's child Task Outcome Summaries and its key-result status (`met` / `missed` / `active`) into a runtime-assembled summary — no agent call. Tasks with no `keyResultId` do not contribute. Severity is `informational`. CEO Office renders `goal_stage_change` rollups in the existing CEO Attention Rollup section but styled as an achievement, visually distinct from exception rollups. Routine per-task completions stay silent, per ADR 0014 / 0017.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Core: add `goal_stage_change` to `CeoAttentionRollupReason` type + `ceoAttentionRollupReasonSchema`.
- [x] `projectCeoAttention` emits a `goal_stage_change` rollup for an objective once every task rolling up to it is terminal; grouped by the `objective` rollup group; `recommendedNextAction` derived (name a `missed` key result if any).
- [x] Tasks with no `keyResultId` never trigger one; an objective with a still-running task has none.
- [x] `buildCompanyState` already serializes `ceoAttentionRollups` — confirm `goal_stage_change` rollups flow through unchanged.
- [x] CEO Office renders `goal_stage_change` rollups with achievement styling, distinct from exception rollups, using existing retro primitives.
- [x] Tests — Seam 2 (`routes.test.ts`): the response includes a `goal_stage_change` rollup with the owning objective and its affected tasks when the objective is complete, and excludes it when a task still runs; a keyResult-less task does not produce one.
- [x] Tests — Seam 3 (`App.test.tsx`): a `goal_stage_change` rollup renders with achievement styling, distinct from an exception rollup.
- [x] Tests — Seam 5 (`schemas.test.ts`): `goal_stage_change` parses as a `CeoAttentionRollupReason`; an unknown reason does not.
