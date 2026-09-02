import type { Task, TaskEvent, TaskProgressEvent } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { recordTaskCompletionEvent } from "./taskCompletion";

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

export type RetryExhaustedTermination = {
  taskEvent: TaskEvent;
  progressEvent: TaskProgressEvent | null;
};

/**
 * Move a task that has hit the Bounded Recovery ceiling into `blocked` / `retry_exhausted` and record
 * the CEO Blocked Queue signals: the `task_blocked` event, the "Recovery ceiling reached" progress
 * event, and a `blocked` task-completion event. The returned events are only appended to the store;
 * the caller emits them on whatever channel it owns (scheduler SSE, refresh/recover result).
 *
 * The single place every ceiling exit routes through -- the scheduler on a failed run, and `refresh`
 * / `recover` when they would otherwise refuse a task that some earlier path left merely `failed`.
 * Idempotent: a task already `blocked` / `retry_exhausted` is left untouched and `null` is returned.
 */
export function terminateAsRetryExhausted(input: {
  repositories: Repositories;
  task: Task;
  executionProfileName?: string | null;
  requestedTimeoutMs?: number | null;
  effectiveTimeoutMs?: number | null;
  dependencyImpact?: unknown;
  now?: () => Date;
  createId?: (prefix: string) => string;
}): RetryExhaustedTermination | null {
  const { repositories, task } = input;
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? ((prefix: string) => `${prefix}_${crypto.randomUUID()}`);

  const current = repositories.getTask(task.id) ?? task;
  if (current.status === "blocked" && current.latestFailureReason === "retry_exhausted") {
    return null;
  }

  const failure = retryExhaustedFailureMessage(task);
  const timestamp = now().toISOString();

  repositories.updateTaskStatus(task.id, "blocked");
  repositories.updateTaskExecutionSummary(task.id, {
    latestFailureReason: "retry_exhausted",
    latestFailureMessage: failure,
  });

  const taskEvent: TaskEvent = {
    id: createId("task_event"),
    companyId: task.companyId,
    taskId: task.id,
    type: "task_blocked",
    message: failure,
    createdAt: timestamp,
    status: "blocked",
    failureReason: "retry_exhausted",
    failureMessage: failure,
    executionProfileName: input.executionProfileName ?? null,
    requestedTimeoutMs: input.requestedTimeoutMs ?? null,
    effectiveTimeoutMs: input.effectiveTimeoutMs ?? null,
    dependencyNote: null,
    artifactWorkspacePath: null,
  };
  repositories.appendTaskEvent(taskEvent);

  const parentTaskId = task.parentTaskId ?? task.id;
  const label = "Recovery ceiling reached";
  const progressAlreadyRecorded = repositories
    .listTaskProgressEventsForParentTask(parentTaskId)
    .some((candidate) => candidate.step === "blocked" && candidate.subjectTaskId === task.id && candidate.label === label);

  let progressEvent: TaskProgressEvent | null = null;
  if (!progressAlreadyRecorded) {
    progressEvent = {
      id: createId("task_progress"),
      companyId: task.companyId,
      departmentId: task.departmentId,
      parentTaskId,
      subjectTaskId: task.id,
      step: "blocked",
      status: "blocked",
      label,
      detail: failure,
      createdAt: timestamp,
    };
    repositories.appendTaskProgressEvent(progressEvent);
  }

  recordTaskCompletionEvent({
    repositories,
    task,
    outcome: "blocked",
    dependencyImpact: input.dependencyImpact ?? { reason: "retry_exhausted" },
    now,
    createId,
  });

  return { taskEvent, progressEvent };
}
