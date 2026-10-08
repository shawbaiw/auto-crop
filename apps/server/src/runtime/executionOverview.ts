import type { createRepositories } from "../db/repositories";

/** Read-only persisted facts. Polling does not run health policy, renew leases or spend budget. */
export function executionOverview(r: ReturnType<typeof createRepositories>, taskId: string) {
  const run = r.executionBudget.latestRun(taskId);
  if (!run) return null;
  const task = r.executionBudget.getTask(taskId);
  const usage = r.executionBudget.taskUsage(taskId);
  const stop = r.executionBudget.stopRequest(run.id);
  return { runId: run.id, status: run.status, phase: stop?.phase ?? run.phase, policyVersion: run.policy_version,
    health: r.executionBudget.health(run.id) ?? null,
    budget: task ? { authorizedMs: task.authorizedMs, consumedMs: usage.consumedMs,
      reservedMs: Math.max(0, task.reservedMs - usage.activeConsumedMs), remainingMs: Math.max(0, task.authorizedMs - usage.consumedMs),
      availableMs: Math.max(0, task.authorizedMs - task.consumedMs - task.reservedMs), estimated: Boolean(usage.estimated) } : null,
    stop: stop ? { reason: stop.cancel_requested ? "cancelled" : stop.reason, manualConfirmedAt: run.manual_termination_confirmed_at, requestedAt: stop.requested_at, terminationWaitMs: stop.termination_wait_ms,
      terminationConfirmed: stop.termination_confirmed === null ? null : Boolean(stop.termination_confirmed) } : run.failure_reason ? { reason: run.failure_reason, requestedAt: null,
        terminationWaitMs: null, terminationConfirmed: null, manualConfirmedAt: run.manual_termination_confirmed_at } : null };
}
