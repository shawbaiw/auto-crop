import type { createRepositories } from "../db/repositories";
import { defaultExecutionRegistry, type ExecutionRegistry } from "./executionControl";
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

  for (const taskId of cancelledTasks) {
    // Cancelling is terminal, so the seam closes every open Hold: a stopped company must not leave
    // the founder a queue of Holds on tasks that will never run again.
    applyTaskTransition({
      repositories: input.repositories,
      task: taskId,
      status: "cancelled",
      resolution: "cancelled",
      now: input.now,
    });
  }

  for (const run of runningRuns) {
    // Conditional: a run that settled while we were deciding to stop it keeps its own outcome.
    input.repositories.updateAgentRunStatus(run.id, "cancelled", finishedAt, {
      failureReason: "cancelled",
      failureMessage: "Execution was stopped by an Emergency Stop.",
      expectedStatus: "running",
    });
  }

  // This company's locks only. Clearing the table took other companies' running work out from under
  // them — a stop for one company must not unlock another's live execution.
  const releasedLocks: string[] = [];
  const companyTaskIds = new Set(input.repositories.listTasksForCompany(input.companyId).map((task) => task.id));
  for (const lock of input.repositories.listTaskLocks()) {
    if (!companyTaskIds.has(lock.taskId)) {
      continue;
    }
    input.repositories.releaseTaskLock(lock.taskId, lock.ownerId, lock.runId);
    releasedLocks.push(lock.taskId);
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
