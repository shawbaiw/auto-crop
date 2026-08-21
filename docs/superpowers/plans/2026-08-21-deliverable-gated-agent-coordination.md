# Deliverable-Gated Agent Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dependent Agent tasks start only after upstream tasks have consumable Proof, and make timeout recovery bounded so oversized tasks become replanning work instead of infinite retries.

**Architecture:** Auto-Crop keeps Proof as the completion gate. The scheduler resolves dependency readiness before dispatch, injects upstream handoffs into dependent prompts, and applies a bounded recovery policy: short -> medium -> long -> needs_replan. Dashboard views present waiting, retrying, missing deliverable, and replanning states as normal workflow states, not as generic failures.

**Tech Stack:** TypeScript, Node.js SQLite runtime, Vitest, React dashboard, existing retro UI primitives.

---

## Domain Terms

- **Consumable Proof:** A Proof row whose `taskId` matches an upstream task and whose URI is the formal handoff for downstream work.
- **Dependency Readiness:** The scheduler's decision about whether every upstream task for a task has consumable Proof.
- **Task Handoff:** Structured prompt context built from upstream Proof rows and optional Artifact Workspace values.
- **Bounded Recovery:** Automatic recovery that changes execution conditions and has a hard end. For timeout this means short -> medium -> long -> needs_replan.
- **Replan Required:** A task state meaning the current task shape exceeded reasonable execution budgets and should be split or rewritten before downstream work starts.

## Files

- Modify: `packages/core/src/types.ts`
  - Add task statuses: `waiting_dependency`, `retrying`, `needs_replan`.
  - Add failure reasons: `missing_deliverable`, `retry_exhausted`, `needs_replan`, `rate_limited`.
  - Add event types: `dependency_waiting`, `dependency_ready`, `task_retrying`, `task_needs_replan`, `deliverable_missing`.
- Modify: `apps/server/src/db/repositories.ts`
  - Fetch both `queued` and due `retrying` tasks.
  - Keep existing task summary fields; no new table is needed for first implementation.
- Create: `apps/server/src/runtime/dependencyReadiness.ts`
  - Resolve upstream task states and Proof rows into `ready`, `waiting`, `blocked`, or `missing_deliverable`.
  - Build `TaskHandoff[]`.
- Modify: `apps/server/src/runtime/executionProfile.ts`
  - Reuse existing retry profile resolution.
- Modify: `apps/server/src/runtime/scheduler.ts`
  - Use dependency readiness before lock acquisition.
  - Mark dependency waits as `waiting_dependency`.
  - Inject handoff context into the prompt.
  - Retry timeout with profile escalation until `long`; after `long` timeout, mark `needs_replan`.
- Modify: `apps/server/src/api/routes.ts`
  - Include the new task statuses and handoff-ready fields through existing summaries.
- Modify: `apps/dashboard/src/api/client.ts`
  - Allow the new statuses/reasons as strings without extra schema work.
- Modify: `apps/dashboard/src/pages/DepartmentWorkspace.tsx`
  - Format new statuses in department task lists.
- Modify: `apps/dashboard/src/pages/CompanyOperations.tsx`
  - Count and describe waiting/retrying/replan states.
- Modify: `apps/dashboard/src/ui/language/translations.ts`
  - Add English/Chinese strings for dependency wait, retrying, missing deliverable, and needs replan.
- Add: `docs/adr/0003-deliverable-gated-dependencies-and-bounded-recovery.md`
  - Record the durable architecture choice.

## Task 1: Extend Runtime Types

**Files:**
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/src/schemas.test.ts`

- [ ] **Step 1: Write failing schema/type tests**

Add tests that parse the new task status, failure reason, and event type through the existing Zod schemas.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @auto-crop/core test`

Expected: FAIL because the schemas/types do not yet accept the new values.

- [ ] **Step 3: Add the values to core types and schemas**

Add:

```ts
"waiting_dependency" | "retrying" | "needs_replan"
```

to task status; add:

```ts
"missing_deliverable" | "retry_exhausted" | "needs_replan" | "rate_limited"
```

to failure reasons; add:

```ts
"dependency_waiting" | "dependency_ready" | "task_retrying" | "task_needs_replan" | "deliverable_missing"
```

to task events.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @auto-crop/core test`

Expected: PASS.

## Task 2: Add Dependency Readiness Resolver

**Files:**
- Create: `apps/server/src/runtime/dependencyReadiness.ts`
- Test: `apps/server/src/runtime/dependencyReadiness.test.ts`

- [ ] **Step 1: Write failing tests**

Cover these scenarios:

1. A downstream task waits when upstream is `queued`, `running`, `retrying`, or `waiting_dependency`.
2. A downstream task is blocked when upstream is `failed`, `blocked`, `cancelled`, or `needs_replan`.
3. A downstream task is blocked as `missing_deliverable` when upstream is `review`/`complete` but has no Proof.
4. A downstream task is ready when upstream is `review`/`complete` and has Proof.
5. Ready output includes `TaskHandoff[]` with upstream task id, proof id/type/uri/summary, and artifact workspace path.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @auto-crop/server test -- src/runtime/dependencyReadiness.test.ts`

Expected: FAIL because the resolver file does not exist.

- [ ] **Step 3: Implement resolver**

Use this public interface:

```ts
export type TaskHandoff = {
  upstreamTaskId: string;
  upstreamTaskTitle: string;
  proofId: string;
  proofType: Proof["type"];
  uri: string;
  summary: string;
  artifactWorkspacePath: string | null;
};

export type DependencyReadiness =
  | { kind: "ready"; handoffs: TaskHandoff[] }
  | { kind: "waiting"; note: string }
  | { kind: "blocked"; reason: "dependency_failed" | "needs_replan"; note: string; dependency: Task }
  | { kind: "missing_deliverable"; note: string; dependency: Task };
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @auto-crop/server test -- src/runtime/dependencyReadiness.test.ts`

Expected: PASS.

## Task 3: Gate Scheduler Dispatch On Consumable Proof

**Files:**
- Modify: `apps/server/src/runtime/scheduler.ts`
- Modify: `apps/server/src/runtime/scheduler.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Cover:

1. A downstream task moves to `waiting_dependency` when upstream is running.
2. A downstream task does not start when upstream is review but lacks Proof.
3. A downstream task starts when upstream has Proof.
4. The dependent agent prompt contains an `## Upstream Handoffs` section.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @auto-crop/server test -- src/runtime/scheduler.test.ts`

Expected: FAIL because current scheduler only waits by status and does not build handoff prompt context.

- [ ] **Step 3: Implement scheduler gating**

Replace the current dependency decision logic with the resolver from Task 2. `waiting` should update task status to `waiting_dependency`; `missing_deliverable` should update status to `blocked` with reason `missing_deliverable`; `blocked` should keep dependency failure semantics. Before dispatch, append handoff details to the task prompt.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @auto-crop/server test -- src/runtime/scheduler.test.ts`

Expected: PASS.

## Task 4: Implement Bounded Timeout Recovery

**Files:**
- Modify: `apps/server/src/runtime/scheduler.ts`
- Modify: `apps/server/src/runtime/scheduler.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:

1. Short timeout retries with medium.
2. Medium timeout retries with long.
3. Long timeout marks task `needs_replan`.
4. Downstream consumers of a `needs_replan` task do not run.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @auto-crop/server test -- src/runtime/scheduler.test.ts`

Expected: FAIL for medium -> long and long -> needs_replan.

- [ ] **Step 3: Implement bounded recovery**

Use existing `resolveRetryTimeout`. Allow one profile escalation per profile, but stop after `long`. When long times out, set:

```ts
status: "needs_replan"
latestFailureReason: "needs_replan"
latestFailureMessage: "Task needs replanning: <title> / exceeded long budget 10m."
```

Emit `task_needs_replan`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @auto-crop/server test -- src/runtime/scheduler.test.ts`

Expected: PASS.

## Task 5: Update API And Dashboard Presentation

**Files:**
- Modify: `apps/dashboard/src/pages/DepartmentWorkspace.tsx`
- Modify: `apps/dashboard/src/pages/CompanyOperations.tsx`
- Modify: `apps/dashboard/src/ui/language/translations.ts`
- Modify: `apps/dashboard/src/App.test.tsx`

- [ ] **Step 1: Write failing dashboard tests**

Cover:

1. `waiting_dependency` appears as localized waiting text.
2. `retrying` appears as localized retrying text.
3. `needs_replan` appears as localized replanning text.
4. Company Operations counts waiting/retrying/replan tasks under attention.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @auto-crop/dashboard test`

Expected: FAIL because formatting does not know the new states.

- [ ] **Step 3: Implement presentation**

Reuse existing components. Add translation keys and format functions only; do not create a new UI primitive.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @auto-crop/dashboard test`

Expected: PASS.

## Task 6: Record Architecture Decision

**Files:**
- Add: `docs/adr/0003-deliverable-gated-dependencies-and-bounded-recovery.md`

- [ ] **Step 1: Write ADR**

Use this decision:

```markdown
# Deliverable-Gated Dependencies And Bounded Recovery

Auto-Crop will start dependent tasks only after upstream tasks produce consumable Proof, and will treat timeout recovery as bounded profile escalation followed by `needs_replan` rather than unbounded retry. This keeps Proof as the completion gate, prevents downstream agents from running on missing inputs, and gives oversized tasks a clear replanning path instead of repeatedly burning time under unchanged conditions.
```

- [ ] **Step 2: Verify docs are linked to domain terms**

Run: `rg "Consumable Proof|Dependency Readiness|Bounded Recovery|needs_replan" CONTEXT.md docs/adr docs/superpowers/plans`

Expected: the terms appear in the plan and ADR.

## Final Verification

- [ ] Run: `pnpm test`
- [ ] Run: `pnpm typecheck`
- [ ] Run: `git diff --check`
- [ ] Run: `git status --short`

Expected:

- All tests pass.
- All workspace typechecks pass.
- No whitespace errors.
- Only intended files are modified.

## Deferred Phase: Automatic Replanning

This plan stops at durable `needs_replan`. Automatic CEO/planner task graph rewrites are deliberately deferred because they need a product decision about whether the system may mutate existing task dependencies without user confirmation. A future plan should add:

- `replan_requests` table.
- Planner prompt and parser.
- Dependency rewiring from oversized task to replacement task chain.
- UI review/approval for replacing a task graph.
