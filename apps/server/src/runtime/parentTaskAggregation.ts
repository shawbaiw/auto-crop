import type { AgentFailureReason, Proof, Task, TaskEvent, TaskProgressEvent, TaskStatus } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";

export type ParentTaskAggregationUpdate = {
  task: Task;
  event?: TaskEvent;
  progressEvent?: TaskProgressEvent;
};

export type ParentTaskAggregationResult = {
  updatedTasks: ParentTaskAggregationUpdate[];
  errors: Array<{
    taskId: string;
    message: string;
  }>;
};

export type PropagateParentTaskAggregationInput = {
  repositories: ReturnType<typeof createRepositories>;
  sourceSubtaskId: string;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

type ParentDependencyReadiness =
  | { kind: "ready"; proofs: Proof[] }
  | { kind: "waiting"; note: string; dependency: Task }
  | { kind: "blocked"; reason: "dependency_failed" | "needs_replan"; note: string; dependency: Task }
  | { kind: "missing_deliverable"; note: string; dependency: Task };

type ParentAggregationUpdate = {
  type: TaskEvent["type"];
  status: TaskStatus;
  failureReason: AgentFailureReason | null;
  failureMessage: string | null;
  dependencyNote: string | null;
  message: string;
  progressStep: TaskProgressEvent["step"];
  progressStatus: TaskProgressEvent["status"];
  progressLabel: string;
  progressDetail: string | null;
  progressSubjectTaskId: string | null;
};

type ParentAggregationContext = Pick<PropagateParentTaskAggregationInput, "repositories" | "now" | "createId">;

export type RefreshParentTaskAggregationInput = ParentAggregationContext & {
  task: Task;
  forceEvent?: boolean;
};

export function propagateParentTaskAggregation(
  input: PropagateParentTaskAggregationInput,
): ParentTaskAggregationResult {
  const result: ParentTaskAggregationResult = {
    updatedTasks: [],
    errors: [],
  };

  const sourceSubtask = input.repositories.getTask(input.sourceSubtaskId);
  if (!sourceSubtask || (sourceSubtask.taskKind ?? "parent") !== "department_subtask") {
    return result;
  }

  for (const consumer of input.repositories.listDependencyConsumers(sourceSubtask.id)) {
    try {
      const update = refreshParentTaskAggregation(input, consumer);
      if (update) {
        result.updatedTasks.push(update);
      }
    } catch (error) {
      result.errors.push({
        taskId: consumer.id,
        message: (error as Error).message,
      });
    }
  }

  return result;
}

export function refreshParentTaskAggregationTask(
  input: RefreshParentTaskAggregationInput,
): ParentTaskAggregationUpdate | null {
  if (!hasDepartmentSubtaskDependency(input.repositories, input.task)) {
    return null;
  }

  return refreshParentTaskAggregation(input, input.task, { forceEvent: input.forceEvent ?? false });
}

function refreshParentTaskAggregation(
  input: ParentAggregationContext,
  parent: Task,
  options: { forceEvent?: boolean } = {},
): ParentTaskAggregationUpdate | null {
  if ((parent.taskKind ?? "parent") !== "parent" || !isAggregationEligible(parent)) {
    return null;
  }

  const readiness = resolveParentDependencyReadiness(input.repositories, parent);
  const update = parentAggregationUpdateForTask(parent, readiness);

  if (!hasMeaningfulChange(parent, update)) {
    if (!options.forceEvent) {
      return null;
    }

    const event = createTaskEvent(input, parent, update);
    input.repositories.appendTaskEvent(event);

    const progressEvent = createTaskProgressEvent(input, parent, update);
    input.repositories.appendTaskProgressEvent(progressEvent);

    const refreshedTask = input.repositories.getTask(parent.id);
    if (!refreshedTask) {
      throw new Error(`Parent task disappeared after aggregation refresh: ${parent.id}`);
    }

    return {
      task: refreshedTask,
      event,
      progressEvent,
    };
  }

  input.repositories.updateTaskStatus(parent.id, update.status);
  input.repositories.updateTaskExecutionSummary(parent.id, {
    latestFailureReason: update.failureReason,
    latestFailureMessage: update.failureMessage,
    dependencyNote: update.dependencyNote,
  });

  const event = createTaskEvent(input, parent, update);
  input.repositories.appendTaskEvent(event);

  const progressEvent = createTaskProgressEvent(input, parent, update);
  input.repositories.appendTaskProgressEvent(progressEvent);

  const refreshedTask = input.repositories.getTask(parent.id);
  if (!refreshedTask) {
    throw new Error(`Parent task disappeared after aggregation: ${parent.id}`);
  }

  return {
    task: refreshedTask,
    event,
    progressEvent,
  };
}

function resolveParentDependencyReadiness(
  repositories: ReturnType<typeof createRepositories>,
  parent: Task,
): ParentDependencyReadiness {
  const dependencies = repositories.listTaskDependencies(parent.id);
  const proofs: Proof[] = [];

  for (const dependency of dependencies) {
    const upstream = repositories.getTask(dependency.dependsOnTaskId);
    if (!upstream) {
      continue;
    }

    const dependencyProofs = repositories.listProofsForTask(upstream.id);
    if ((upstream.taskKind ?? "parent") === "department_subtask") {
      const subtaskReadiness = resolveDepartmentSubtaskReadiness(upstream, dependencyProofs);
      if (subtaskReadiness.kind !== "ready") {
        return subtaskReadiness;
      }
      proofs.push(...subtaskReadiness.proofs);
      continue;
    }

    const taskReadiness = resolveOrdinaryDependencyReadiness(upstream, dependencyProofs);
    if (taskReadiness.kind !== "ready") {
      return taskReadiness;
    }
    proofs.push(...taskReadiness.proofs);
  }

  return { kind: "ready", proofs };
}

function resolveDepartmentSubtaskReadiness(task: Task, proofs: Proof[]): ParentDependencyReadiness {
  if ((task.status === "review" || task.status === "complete") && proofs.length > 0) {
    return { kind: "ready", proofs };
  }

  if (isWaitingStatus(task.status)) {
    return {
      kind: "waiting",
      note: `Waiting for department subtask deliverable: ${task.title} (${task.status}).`,
      dependency: task,
    };
  }

  if (task.status === "needs_replan") {
    return {
      kind: "blocked",
      reason: "needs_replan",
      note: `Waiting for department subtask to be replanned: ${task.title}.`,
      dependency: task,
    };
  }

  if (isFailedDependencyStatus(task.status)) {
    return {
      kind: "blocked",
      reason: "dependency_failed",
      note: `Blocked by department subtask: ${task.title} (${task.status}).`,
      dependency: task,
    };
  }

  return {
    kind: "missing_deliverable",
    note: `Missing department subtask proof: ${task.title}.`,
    dependency: task,
  };
}

function resolveOrdinaryDependencyReadiness(task: Task, proofs: Proof[]): ParentDependencyReadiness {
  if (isWaitingStatus(task.status)) {
    return {
      kind: "waiting",
      note: `Waiting for dependency deliverable: ${task.title} (${task.status}).`,
      dependency: task,
    };
  }

  if (task.status === "needs_replan") {
    return {
      kind: "blocked",
      reason: "needs_replan",
      note: `Waiting for dependency to be replanned: ${task.title}.`,
      dependency: task,
    };
  }

  if (isFailedDependencyStatus(task.status)) {
    return {
      kind: "blocked",
      reason: "dependency_failed",
      note: `Blocked by failed dependency: ${task.title}.`,
      dependency: task,
    };
  }

  if (proofs.length === 0) {
    return {
      kind: "missing_deliverable",
      note: `Missing consumable proof from dependency: ${task.title}.`,
      dependency: task,
    };
  }

  return { kind: "ready", proofs };
}

function parentAggregationUpdateForTask(parent: Task, readiness: ParentDependencyReadiness): ParentAggregationUpdate {
  if (readiness.kind === "ready") {
    return {
      type: "dependency_ready",
      status: "queued",
      failureReason: null,
      failureMessage: null,
      dependencyNote: null,
      message: `Parent task queued for proof summarization: ${parent.title}.`,
      progressStep: "summarizing_proof",
      progressStatus: "current",
      progressLabel: "Ready to summarize department subtask proof.",
      progressDetail: null,
      progressSubjectTaskId: parent.id,
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
      progressStep: "executing",
      progressStatus: "current",
      progressLabel: `Waiting on ${readiness.dependency.title}.`,
      progressDetail: readiness.note,
      progressSubjectTaskId: readiness.dependency.id,
    };
  }

  if (readiness.kind === "missing_deliverable") {
    const failureReason = "missing_deliverable";
    const failureMessage = `Parent task blocked: ${parent.title} / missing_deliverable / ${readiness.dependency.title} has no consumable proof.`;
    return {
      type: "deliverable_missing",
      status: "blocked",
      failureReason,
      failureMessage,
      dependencyNote: readiness.note,
      message: failureMessage,
      progressStep: "blocked",
      progressStatus: "blocked",
      progressLabel: `Blocked by ${readiness.dependency.title}.`,
      progressDetail: readiness.note,
      progressSubjectTaskId: readiness.dependency.id,
    };
  }

  const failureMessage = `Parent task blocked: ${parent.title} / ${readiness.reason} / ${readiness.dependency.title} is ${readiness.dependency.status}.`;
  return {
    type: "task_blocked",
    status: "blocked",
    failureReason: readiness.reason,
    failureMessage,
    dependencyNote: readiness.note,
    message: failureMessage,
    progressStep: "blocked",
    progressStatus: "blocked",
    progressLabel: `Blocked by ${readiness.dependency.title}.`,
    progressDetail: readiness.note,
    progressSubjectTaskId: readiness.dependency.id,
  };
}

function isAggregationEligible(task: Task): boolean {
  return task.status === "blocked" || task.status === "waiting_dependency";
}

function hasDepartmentSubtaskDependency(
  repositories: ReturnType<typeof createRepositories>,
  task: Task,
): boolean {
  if ((task.taskKind ?? "parent") !== "parent") {
    return false;
  }

  return repositories
    .listTaskDependencies(task.id)
    .some((dependency) => (repositories.getTask(dependency.dependsOnTaskId)?.taskKind ?? "parent") === "department_subtask");
}

function isWaitingStatus(status: Task["status"]): boolean {
  return status === "queued" || status === "waiting_dependency" || status === "running" || status === "retrying";
}

function isFailedDependencyStatus(status: Task["status"]): boolean {
  return status === "failed" || status === "blocked" || status === "cancelled";
}

function hasMeaningfulChange(task: Task, update: ParentAggregationUpdate): boolean {
  return (
    task.status !== update.status ||
    (task.latestFailureReason ?? null) !== update.failureReason ||
    (task.latestFailureMessage ?? null) !== update.failureMessage ||
    (task.dependencyNote ?? null) !== update.dependencyNote
  );
}

function createTaskEvent(
  input: ParentAggregationContext,
  task: Task,
  update: ParentAggregationUpdate,
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
  input: ParentAggregationContext,
  task: Task,
  update: ParentAggregationUpdate,
): TaskProgressEvent {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;

  return {
    id: createId("task_progress"),
    companyId: task.companyId,
    departmentId: task.departmentId,
    parentTaskId: task.id,
    subjectTaskId: update.progressSubjectTaskId,
    step: update.progressStep,
    status: update.progressStatus,
    label: update.progressLabel,
    detail: update.progressDetail,
    createdAt: now().toISOString(),
  };
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
