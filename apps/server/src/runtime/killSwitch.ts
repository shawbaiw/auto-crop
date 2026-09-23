import type { createRepositories } from "../db/repositories";
import { defaultExecutionRegistry, type ExecutionRegistry } from "./executionControl";
import { settleAgentRun } from "./executionSettlement";
import { applyTaskTransition } from "./taskTransition";

export type TriggerKillSwitchInput = {
  companyId: string;
  repositories: ReturnType<typeof createRepositories>;
  now?: () => Date;
  /** Where live executions are registered, so a stop reaches the processes. */
  executionRegistry?: ExecutionRegistry;
  stopCompanySessions?: (companyId: string, reason: string) => string[];
};

export type TriggerKillSwitchResult = {
  cancelledTasks: string[];
  releasedLocks: string[];
  stoppedSessions: string[];
  /** Tasks whose runs this process could not reach, because another worker owns them. */
  unreachableTasks: string[];
};

/**
 * Stop a company: end the work in flight, and say honestly what could not be reached.
 *
 * This used to be a status change with no teeth. It wrote `cancelled`, cleared **every** lock in the
 * database — other companies' included — and left the agent processes running: the founder was told
 * the company had stopped while it went on spending, and the next dispatch of those tasks started in
 * workspaces the abandoned processes were still writing to.
 *
 * Now the stop reaches the processes through the execution registry, and the clearing is scoped to
 * this company's own tasks. Runs owned by another worker cannot be stopped from here — they are
 * reported as unreachable rather than quietly counted as stopped; reaching them needs the
 * out-of-process Supervisor (execution-health P3).
 */
export function triggerKillSwitch(input: TriggerKillSwitchInput): TriggerKillSwitchResult {
  const now = input.now ?? (() => new Date());
  const registry = input.executionRegistry ?? defaultExecutionRegistry;
  const finishedAt = now().toISOString();
  const runningRuns = input.repositories.listRunningAgentRuns(input.companyId);
  const cancelledTasks = [...new Set(runningRuns.map((run) => run.taskId))];

  input.repositories.setGlobalPaused(true);

  // Ask the live processes to stop before recording anything: a task marked cancelled while its
  // agent still runs is the state this exists to prevent.
  const reachable = new Set(registry.requestStopForCompany(input.companyId, "emergency_stop"));

  const releasedLocks: string[] = [];
  for (const run of runningRuns) {
    settleAgentRun({
      repositories: input.repositories, runId: run.id,
      outcome: { status: "cancelled", failureReason: "cancelled", failureMessage: "Execution was stopped by an Emergency Stop." },
      at: finishedAt, createId: (prefix) => `${prefix}_${crypto.randomUUID()}`,
      commit: () => {
        applyTaskTransition({
          repositories: input.repositories, task: run.taskId, status: "cancelled",
          resolution: "cancelled", now: input.now,
        });
        if (input.repositories.releaseTaskLockForRun(run.taskId, run.id, run.ownerEpoch == null)) releasedLocks.push(run.taskId);
      },
    });
  }

  // Legacy unbound locks with no running run retain their existing scoped cleanup behavior.
  const companyTaskIds = new Set(input.repositories.listTasksForCompany(input.companyId).map((task) => task.id));
  for (const lock of input.repositories.listTaskLocks()) {
    if (companyTaskIds.has(lock.taskId) && lock.runId === null && !cancelledTasks.includes(lock.taskId)) {
      if (input.repositories.releaseTaskLock(lock.taskId, lock.ownerId, null)) releasedLocks.push(lock.taskId);
    }
  }

  const stoppedSessions = input.stopCompanySessions?.(input.companyId, "emergency_stop") ?? [];
  input.repositories.updateCompanyStatus(input.companyId, "review", finishedAt);

  return {
    cancelledTasks,
    releasedLocks,
    stoppedSessions,
    unreachableTasks: cancelledTasks.filter((taskId) => !reachable.has(taskId)),
  };
}
