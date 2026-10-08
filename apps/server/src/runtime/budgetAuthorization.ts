import type { createRepositories } from "../db/repositories";
import { applyTaskTransition } from "./taskTransition";
import { recordExecutionEvent } from "./executionEvents";
import { isBudgetExhaustion } from "./budgetPolicy";

type Repositories = ReturnType<typeof createRepositories>;
export class BudgetAuthorizationError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

/** Explicit, idempotent authorization to continue the SAME Task. Zero means use remaining funds. */
export function authorizeExecutionBudget(input: {
  repositories: Repositories; taskId: string; id: string; additionalMs: number; reason: string;
  expectedAuthorizedMs: number; now?: () => Date; createId?: (prefix: string) => string;
}) {
  if (typeof input.id !== "string" || !input.id.trim() || input.id.length > 200
    || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000
    || !Number.isSafeInteger(input.additionalMs) || input.additionalMs < 0
    || !Number.isSafeInteger(input.expectedAuthorizedMs) || input.expectedAuthorizedMs <= 0) {
    throw new BudgetAuthorizationError("id, reason, nonnegative additionalMs and positive expectedAuthorizedMs are required", 400);
  }
  const r = input.repositories;
  const at = (input.now?.() ?? new Date()).toISOString();
  return r.transaction(() => {
    // First SQL is a write, so another connection cannot invalidate the snapshot we authorize.
    if (!r.executionBudget.lockAuthorization(input.taskId)) throw new BudgetAuthorizationError("Task has no execution authorization");
    const existing = r.executionBudget.authorization(input.id);
    if (existing) {
      if (existing.task_id !== input.taskId || existing.additional_ms !== input.additionalMs
        || existing.reason !== input.reason || existing.authorized_before_ms !== input.expectedAuthorizedMs) {
        throw new BudgetAuthorizationError("Authorization id was already used for different input");
      }
      return { authorization: existing, replayed: true, task: r.getTask(input.taskId)! };
    }
    const task = r.getTask(input.taskId);
    if (!task || (task.status !== "blocked" && task.status !== "failed")) throw new BudgetAuthorizationError("Task is not parked on its execution budget");
    const holds = r.listOpenTaskHolds(task.id);
    if (!holds.some(h => h.kind === "execution_budget_exhausted") || holds.some(h => h.kind !== "execution_budget_exhausted")) {
      throw new BudgetAuthorizationError("Resolve other task Holds, including termination confirmation, before authorizing execution");
    }
    const budget = r.executionBudget.getTask(task.id)!;
    if (budget.reservedMs > 0 || r.listRunningAgentRuns(task.companyId).some(run => run.taskId === task.id)
      || r.listWorkspaceClaims().some(claim => claim.taskId === task.id)) throw new BudgetAuthorizationError("Task still owns execution or workspace claims");
    if (budget.authorizedMs !== input.expectedAuthorizedMs) throw new BudgetAuthorizationError("Execution authorization changed; refresh before granting more");
    if (!Number.isSafeInteger(budget.authorizedMs + input.additionalMs)) throw new BudgetAuthorizationError("Authorization exceeds safe integer range", 400);
    if (budget.authorizedMs + input.additionalMs <= budget.consumedMs) throw new BudgetAuthorizationError("No remaining execution budget; an explicit increase is required");
    r.executionBudget.authorize({ id: input.id, taskId: task.id, additionalMs: input.additionalMs, reason: input.reason, at });
    const transitioned = applyTaskTransition({ repositories: r, task, status: "queued",
      resolvesHoldKinds: ["execution_budget_exhausted"], resolution: "cleared",
      executionSummary: { latestFailureReason: null, latestFailureMessage: null }, now: () => new Date(at), createId: input.createId });
    if (!transitioned.moved) throw new BudgetAuthorizationError("Task cannot resume while another Hold remains");
    r.appendTaskEvent({ id: `budget-authorization:${input.id}`, companyId: task.companyId, taskId: task.id,
      type: "task_recovered", status: "queued", failureReason: null, failureMessage: null, executionProfileName: null, requestedTimeoutMs: null, effectiveTimeoutMs: null, dependencyNote: null, artifactWorkspacePath: task.artifactWorkspacePath ?? null, message: `Founder authorized execution with ${input.additionalMs}ms additional budget: ${input.reason}`, createdAt: at });
    return { authorization: r.executionBudget.authorization(input.id)!, replayed: false, task: transitioned.task };
  });
}

/** Same gate for direct recovery callers and HTTP; never create an unbudgeted follow-up Task. */
export function assertOrdinaryRecoveryAllowed(r: Repositories, taskId: string): void {
  const task = r.getTask(taskId);
  const budget = r.executionBudget.getTask(taskId);
  if (!budget) return;
  if (isBudgetExhaustion(task?.latestFailureReason) || budget.authorizedMs <= budget.consumedMs + budget.reservedMs
    || r.listOpenTaskHolds(taskId).some(h => h.kind === "execution_budget_exhausted")) {
    throw new BudgetAuthorizationError("Execution budget requires explicit founder authorization");
  }
}

/** An exhausted Task remains actionable after a restart or a legal attempt-counter reset. */
export function parkExhaustedTask(r: Repositories, taskId: string, at: string): boolean {
  return r.transaction(() => {
    if (!r.executionBudget.lockAuthorization(taskId)) return false;
    const budget = r.executionBudget.getTask(taskId)!;
    const task = r.getTask(taskId);
    if (!task || !["queued", "retrying"].includes(task.status) || budget.reservedMs > 0
      || budget.consumedMs < budget.authorizedMs) return false;
    applyTaskTransition({ repositories: r, task, status: "blocked",
      executionSummary: { latestFailureReason: "task_budget_exhausted", latestFailureMessage: "Task execution budget is exhausted; explicit authorization is required." },
      now: () => new Date(at) });
    recordExecutionEvent(r, { id: `task-budget:${taskId}:${crypto.randomUUID()}`, type: "execution_budget_exhausted",
      companyId: task.companyId, taskId, reason: "task_budget_exhausted", observedAt: at });
    return true;
  });
}
