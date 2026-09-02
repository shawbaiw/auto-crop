import type { Task } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";

type Repositories = ReturnType<typeof createRepositories>;

/**
 * The per-task attempt ceiling. After this many failed Agent Runs a task terminates as
 * `blocked` / `retry_exhausted` and is routed to the CEO Blocked Queue instead of being
 * re-queued again. Only a new accepted upstream Business Artifact or a CEO replan resets it.
 */
export const MAX_TASK_ATTEMPTS = 3;

/**
 * Failed/abandoned agent dispatches for this task since the last reset, counted from `agent_runs`
 * rows (completed and cancelled runs do not count, so a task returned from review starts fresh).
 */
export function taskAttemptCount(repositories: Repositories, taskId: string): number {
  return repositories.countAgentRunsForTask(taskId);
}

export function isRetryExhausted(repositories: Repositories, taskId: string): boolean {
  return taskAttemptCount(repositories, taskId) >= MAX_TASK_ATTEMPTS;
}

/**
 * Reset the attempt count by moving the reset marker forward, so agent-run history is preserved
 * for diagnosis (ADR 0002). Called only when a new accepted upstream Business Artifact or a CEO
 * replan rescues the task.
 */
export function resetTaskAttempts(repositories: Repositories, taskId: string, at: string): void {
  repositories.markTaskAttemptsReset(taskId, at);
}

export function retryExhaustedFailureMessage(task: Pick<Task, "title">): string {
  return `Task blocked: ${task.title} / retry_exhausted / reached the ${MAX_TASK_ATTEMPTS}-attempt recovery ceiling; a new accepted upstream Business Artifact or a CEO replan is required.`;
}

export function retryExhaustedRefusalMessage(task: Pick<Task, "id" | "title">): string {
  return `Task ${task.id} (${task.title}) has reached the ${MAX_TASK_ATTEMPTS}-attempt recovery ceiling (retry_exhausted); only a new accepted upstream Business Artifact or a CEO replan can resume it.`;
}
