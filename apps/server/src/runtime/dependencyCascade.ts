import type { AgentFailureReason, Task, TaskEvent, TaskProgressEvent, TaskStatus } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { resolveDependencyReadiness } from "./dependencyReadiness";

export type DependencyCascadeUpdate = {
  task: Task;
  event?: TaskEvent;
  progressEvent?: TaskProgressEvent;
};

export type DependencyCascadeResult = {
  updatedTasks: DependencyCascadeUpdate[];
  errors: Array<{
    taskId: string;
    message: string;
  }>;
};

export type PropagateDependencyCascadeInput = {
  repositories: ReturnType<typeof createRepositories>;
  sourceTaskId: string;
  maxDepth?: number;
  now?: () => Date;
  createId?: (prefix: string) => string;
  visitedTaskIds?: Set<string>;
};

type DependencyUpdate = {
  type: TaskEvent["type"];
  status: TaskStatus;
  failureReason: AgentFailureReason | null;
  failureMessage: string | null;
  dependencyNote: string | null;
  message: string;
  progressLabel?: string;
};

type DependencyRefreshContext = Pick<RefreshDependencyTasksInput, "repositories" | "now" | "createId">;

export type RefreshDependencyTasksInput = {
  repositories: ReturnType<typeof createRepositories>;
  tasks: Task[];
  forceEvent?: boolean;
  includeUnchangedTasks?: boolean;
  ignoreCascadeEligibility?: boolean;
  progressLabel?: string;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export function propagateDependencyCascade(input: PropagateDependencyCascadeInput): DependencyCascadeResult {
  const maxDepth = clampCascadeDepth(input.maxDepth ?? 1);
  const visitedTaskIds = input.visitedTaskIds ?? new Set<string>();
  const result: DependencyCascadeResult = {
    updatedTasks: [],
    errors: [],
  };

  if (maxDepth < 1 || visitedTaskIds.has(input.sourceTaskId)) {
    return result;
  }

  visitedTaskIds.add(input.sourceTaskId);
  let frontierTaskIds = [input.sourceTaskId];

  for (let depth = 1; depth <= maxDepth && frontierTaskIds.length > 0; depth += 1) {
    const candidatesById = new Map<string, Task>();

    for (const frontierTaskId of frontierTaskIds) {
      try {
        for (const consumer of input.repositories.listDependencyConsumers(frontierTaskId)) {
          if (!visitedTaskIds.has(consumer.id) && !candidatesById.has(consumer.id)) {
            candidatesById.set(consumer.id, consumer);
          }
        }
      } catch (error) {
        result.errors.push({
          taskId: frontierTaskId,
          message: (error as Error).message,
        });
      }
    }

    frontierTaskIds = [];

    for (const consumer of candidatesById.values()) {
      visitedTaskIds.add(consumer.id);

      try {
        const update = refreshDependencyTask(input, consumer);
        if (update) {
          result.updatedTasks.push(update);
          if (update.task.status === "queued") {
            frontierTaskIds.push(update.task.id);
          }
        }
      } catch (error) {
        result.errors.push({
          taskId: consumer.id,
          message: (error as Error).message,
        });
      }
    }
  }

  return result;
}

export function refreshDependencyTasks(input: RefreshDependencyTasksInput): DependencyCascadeResult {
  const result: DependencyCascadeResult = {
    updatedTasks: [],
    errors: [],
  };

  for (const task of input.tasks) {
    try {
      const update = refreshDependencyTask(input, task, {
        forceEvent: input.forceEvent ?? false,
        includeUnchangedTask: input.includeUnchangedTasks ?? false,
        ignoreCascadeEligibility: input.ignoreCascadeEligibility ?? false,
        progressLabel: input.progressLabel,
      });
      if (update) {
        result.updatedTasks.push(update);
      }
    } catch (error) {
      result.errors.push({
        taskId: task.id,
        message: (error as Error).message,
      });
    }
  }

  return result;
}

function refreshDependencyTask(
  input: DependencyRefreshContext,
  task: Task,
  options: {
    forceEvent?: boolean;
    includeUnchangedTask?: boolean;
    ignoreCascadeEligibility?: boolean;
    progressLabel?: string;
  } = {},
): DependencyCascadeUpdate | null {
  if (!options.ignoreCascadeEligibility && !isCascadeEligible(task)) {
    if (options.includeUnchangedTask) {
      return refreshedTaskOnly(input.repositories, task);
    }
    return null;
  }

  const readiness = resolveDependencyReadiness(input.repositories, task);
  const update = dependencyUpdateForTask(task, readiness);

  if (!update) {
    return null;
  }

  if (!hasMeaningfulChange(task, update)) {
    if (options.forceEvent) {
      const event = createTaskEvent(input, task, update);
      input.repositories.appendTaskEvent(event);

      const progressLabel = options.progressLabel ?? update.progressLabel;
      const progressEvent = progressLabel ? createTaskProgressEvent(input, task, progressLabel) : undefined;
      if (progressEvent) {
        input.repositories.appendTaskProgressEvent(progressEvent);
      }

      const refreshedTask = input.repositories.getTask(task.id);
      if (!refreshedTask) {
        throw new Error(`Task disappeared after dependency refresh: ${task.id}`);
      }

      return {
        task: refreshedTask,
        event,
        progressEvent,
      };
    }

    if (options.includeUnchangedTask) {
      return refreshedTaskOnly(input.repositories, task);
    }
    return null;
  }

  input.repositories.updateTaskStatus(task.id, update.status);
  input.repositories.updateTaskExecutionSummary(task.id, {
    latestFailureReason: update.failureReason,
    latestFailureMessage: update.failureMessage,
    dependencyNote: update.dependencyNote,
  });

  const event = createTaskEvent(input, task, update);
  input.repositories.appendTaskEvent(event);

  const progressLabel = options.progressLabel ?? update.progressLabel;
  const progressEvent = progressLabel ? createTaskProgressEvent(input, task, progressLabel) : undefined;
  if (progressEvent) {
    input.repositories.appendTaskProgressEvent(progressEvent);
  }

  const refreshedTask = input.repositories.getTask(task.id);
  if (!refreshedTask) {
    throw new Error(`Task disappeared after dependency cascade: ${task.id}`);
  }

  return {
    task: refreshedTask,
    event,
    progressEvent,
  };
}

function isCascadeEligible(task: Task): boolean {
  if (task.status === "waiting_dependency") {
    return true;
  }

  if (task.status !== "blocked") {
    return false;
  }

  return (
    task.latestFailureReason === "dependency_failed" ||
    task.latestFailureReason === "missing_deliverable" ||
    task.latestFailureReason === "needs_replan" ||
    Boolean(task.dependencyNote)
  );
}

function refreshedTaskOnly(
  repositories: ReturnType<typeof createRepositories>,
  task: Task,
): DependencyCascadeUpdate | null {
  const refreshedTask = repositories.getTask(task.id);
  if (!refreshedTask) {
    throw new Error(`Task disappeared during dependency refresh: ${task.id}`);
  }
  return { task: refreshedTask };
}

function dependencyUpdateForTask(
  task: Task,
  readiness: ReturnType<typeof resolveDependencyReadiness>,
): DependencyUpdate | null {
  if (readiness.kind === "ready") {
    return {
      type: "dependency_ready",
      status: "queued",
      failureReason: null,
      failureMessage: null,
      dependencyNote: null,
      message: `Task queued after upstream approval: ${task.title}.`,
      progressLabel: "Dependency ready after upstream approval; queued for scheduler.",
    };
  }

  if (readiness.kind === "waiting") {
    return {
      type: "dependency_waiting",
      status: "waiting_dependency",
      failureReason: null,
      failureMessage: null,
      dependencyNote: readiness.note,
      message: readiness.note,
    };
  }

  if (readiness.kind === "missing_deliverable") {
    const failureReason = "missing_deliverable";
    const failureMessage = `Task blocked: ${task.title} / missing_deliverable / ${readiness.dependency.title} has no accepted business artifact.`;
    return {
      type: "deliverable_missing",
      status: "blocked",
      failureReason,
      failureMessage,
      dependencyNote: readiness.note,
      message: failureMessage,
    };
  }

  const failureMessage = `Task blocked: ${task.title} / ${readiness.reason} / ${readiness.dependency.title} is ${readiness.dependency.status}.`;
  return {
    type: "task_blocked",
    status: "blocked",
    failureReason: readiness.reason,
    failureMessage,
    dependencyNote: readiness.note,
    message: failureMessage,
  };
}

function hasMeaningfulChange(task: Task, update: DependencyUpdate): boolean {
  return (
    task.status !== update.status ||
    (task.latestFailureReason ?? null) !== update.failureReason ||
    (task.latestFailureMessage ?? null) !== update.failureMessage ||
    (task.dependencyNote ?? null) !== update.dependencyNote
  );
}

function createTaskEvent(
  input: DependencyRefreshContext,
  task: Task,
  update: DependencyUpdate,
): TaskEvent {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;

  return {
    id: createId("task_event"),
    companyId: task.companyId,
    taskId: task.id,
    type: update.type,
    message: update.message,
    createdAt: now().toISOString(),
    status: update.status,
    failureReason: update.failureReason,
    failureMessage: update.failureMessage,
    executionProfileName: null,
    requestedTimeoutMs: null,
    effectiveTimeoutMs: null,
    dependencyNote: update.dependencyNote,
    artifactWorkspacePath: task.artifactWorkspacePath ?? null,
  };
}

function createTaskProgressEvent(
  input: DependencyRefreshContext,
  task: Task,
  label: string,
): TaskProgressEvent {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;

  return {
    id: createId("task_progress"),
    companyId: task.companyId,
    departmentId: task.departmentId,
    parentTaskId: task.parentTaskId ?? task.id,
    subjectTaskId: task.id,
    step: "executing",
    status: "current",
    label,
    detail: null,
    createdAt: now().toISOString(),
  };
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clampCascadeDepth(depth: number): number {
  return Math.min(Math.max(Math.trunc(depth), 0), 5);
}
