import type { createRepositories } from "../db/repositories";
import { applyTaskTransition } from "./taskTransition";

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
