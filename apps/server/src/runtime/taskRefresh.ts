import type { AgentFailureReason, Task, TaskEvent, TaskStatus } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { resolveDependencyReadiness } from "./dependencyReadiness";

export type RefreshTaskDependencyStateInput = {
  repositories: ReturnType<typeof createRepositories>;
  taskId: string;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export type RefreshTaskDependencyStateResult = {
  task: Task;
  event: TaskEvent;
};

export function refreshTaskDependencyState(
  input: RefreshTaskDependencyStateInput,
): RefreshTaskDependencyStateResult {
  const task = input.repositories.getTask(input.taskId);

  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  if (!isRefreshableStatus(task.status)) {
    throw new Error(`Task ${task.id} cannot be refreshed from status ${task.status}.`);
  }

  const readiness = resolveDependencyReadiness(input.repositories, task);

  if (readiness.kind === "ready") {
    input.repositories.updateTaskStatus(task.id, "queued");
    input.repositories.updateTaskExecutionSummary(task.id, {
      latestFailureReason: null,
      latestFailureMessage: null,
      dependencyNote: null,
    });
    return recordRefreshEvent(input, task, {
      type: "dependency_ready",
      message: `Task refreshed: ${task.title} is queued because dependencies are ready.`,
      status: "queued",
      failureReason: null,
      failureMessage: null,
      dependencyNote: null,
    });
  }

  if (readiness.kind === "waiting") {
    input.repositories.updateTaskStatus(task.id, "waiting_dependency");
    input.repositories.updateTaskExecutionSummary(task.id, {
      latestFailureReason: null,
      latestFailureMessage: null,
      dependencyNote: readiness.note,
    });
    return recordRefreshEvent(input, task, {
      type: "dependency_waiting",
      message: readiness.note,
      status: "waiting_dependency",
      failureReason: null,
      failureMessage: null,
      dependencyNote: readiness.note,
    });
  }

  if (readiness.kind === "missing_deliverable") {
    const failureReason = "missing_deliverable";
    const failureMessage = `Task blocked: ${task.title} / missing_deliverable / ${readiness.dependency.title} has no consumable proof.`;
    input.repositories.updateTaskStatus(task.id, "blocked");
    input.repositories.updateTaskExecutionSummary(task.id, {
      latestFailureReason: failureReason,
      latestFailureMessage: failureMessage,
      dependencyNote: readiness.note,
    });
    return recordRefreshEvent(input, task, {
      type: "deliverable_missing",
      message: failureMessage,
      status: "blocked",
      failureReason,
      failureMessage,
      dependencyNote: readiness.note,
    });
  }

  const failureMessage = `Task blocked: ${task.title} / ${readiness.reason} / ${readiness.dependency.title} is ${readiness.dependency.status}.`;
  input.repositories.updateTaskStatus(task.id, "blocked");
  input.repositories.updateTaskExecutionSummary(task.id, {
    latestFailureReason: readiness.reason,
    latestFailureMessage: failureMessage,
    dependencyNote: readiness.note,
  });
  return recordRefreshEvent(input, task, {
    type: "task_blocked",
    message: failureMessage,
    status: "blocked",
    failureReason: readiness.reason,
    failureMessage,
    dependencyNote: readiness.note,
  });
}

function isRefreshableStatus(status: TaskStatus): boolean {
  return status === "blocked" || status === "failed" || status === "waiting_dependency";
}

function recordRefreshEvent(
  input: RefreshTaskDependencyStateInput,
  task: Task,
  event: {
    type: TaskEvent["type"];
    message: string;
    status: TaskStatus;
    failureReason: AgentFailureReason | null;
    failureMessage: string | null;
    dependencyNote: string | null;
  },
): RefreshTaskDependencyStateResult {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const record: TaskEvent = {
    id: createId("task_event"),
    companyId: task.companyId,
    taskId: task.id,
    type: event.type,
    message: event.message,
    createdAt: now().toISOString(),
    status: event.status,
    failureReason: event.failureReason,
    failureMessage: event.failureMessage,
    executionProfileName: null,
    requestedTimeoutMs: null,
    effectiveTimeoutMs: null,
    dependencyNote: event.dependencyNote,
    artifactWorkspacePath: task.artifactWorkspacePath ?? null,
  };
  input.repositories.appendTaskEvent(record);

  const refreshedTask = input.repositories.getTask(task.id);

  if (!refreshedTask) {
    throw new Error(`Task disappeared after refresh: ${task.id}`);
  }

  return { task: refreshedTask, event: record };
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
