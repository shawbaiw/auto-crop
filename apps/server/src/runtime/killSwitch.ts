import type { createRepositories } from "../db/repositories";

export type TriggerKillSwitchInput = {
  companyId: string;
  repositories: ReturnType<typeof createRepositories>;
  now?: () => Date;
  cancelActiveRun: (taskId: string) => void;
  stopCompanySessions?: (companyId: string, reason: string) => string[];
};

export type TriggerKillSwitchResult = {
  cancelledTasks: string[];
  releasedLocks: string[];
  stoppedSessions: string[];
};

export function triggerKillSwitch(input: TriggerKillSwitchInput): TriggerKillSwitchResult {
  const now = input.now ?? (() => new Date());
  const finishedAt = now().toISOString();
  const runningRuns = input.repositories.listRunningAgentRuns(input.companyId);
  const cancelledTasks = [...new Set(runningRuns.map((run) => run.taskId))];

  input.repositories.setGlobalPaused(true);

  for (const taskId of cancelledTasks) {
    input.cancelActiveRun(taskId);
    input.repositories.updateTaskStatus(taskId, "cancelled");
  }

  for (const run of runningRuns) {
    input.repositories.updateAgentRunStatus(run.id, "cancelled", finishedAt);
  }

  const releasedLocks = input.repositories.releaseAllTaskLocks();
  const stoppedSessions = input.stopCompanySessions?.(input.companyId, "emergency_stop") ?? [];
  input.repositories.updateCompanyStatus(input.companyId, "review", finishedAt);

  return {
    cancelledTasks,
    releasedLocks,
    stoppedSessions,
  };
}
