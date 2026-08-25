import type { Proof, ProofSchema, Task, TaskEvent, TaskProgressEvent } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { formatExecutionBudget } from "./executionProfile";
import { recoverProofIfPossible } from "./taskRefresh";

export type ReconcileStaleRunningTasksInput = {
  repositories: ReturnType<typeof createRepositories>;
  companyId: string;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export type ReconcileStaleRunningTasksResult = {
  reconciledTaskIds: string[];
  events: TaskEvent[];
  progressEvents: TaskProgressEvent[];
};

export type RecoverTaskInput = {
  repositories: ReturnType<typeof createRepositories>;
  taskId: string;
  proofSchemas?: ProofSchema[];
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export type RecoverTaskResult = {
  task: Task;
  event: TaskEvent;
  progressEvent?: TaskProgressEvent;
  followUpTask?: Task;
  proof?: Proof[];
  recovery: {
    status: "queued" | "follow_up_created" | "proof_recovered";
    message: string;
  };
};

export function reconcileStaleRunningTasks(input: ReconcileStaleRunningTasksInput): ReconcileStaleRunningTasksResult {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const timestamp = now().toISOString();
  const reconciledTaskIds: string[] = [];
  const events: TaskEvent[] = [];
  const progressEvents: TaskProgressEvent[] = [];

  for (const run of input.repositories.listRunningAgentRuns(input.companyId)) {
    if (!run.startedAt || !run.effectiveTimeoutMs) {
      continue;
    }

    const deadline = Date.parse(run.startedAt) + run.effectiveTimeoutMs;
    if (Number.isNaN(deadline) || deadline > now().getTime()) {
      continue;
    }

    const task = input.repositories.getTask(run.taskId);
    if (!task || task.status !== "running") {
      continue;
    }

    const failureMessage = `Task failed: ${task.title} / timeout after ${formatExecutionBudget(run.effectiveTimeoutMs)}.`;
    input.repositories.updateAgentRunStatus(run.id, "failed", timestamp, {
      failureReason: "timeout",
      failureMessage,
    });
    input.repositories.updateTaskStatus(task.id, "failed");
    input.repositories.updateTaskExecutionSummary(task.id, {
      latestFailureReason: "timeout",
      latestFailureMessage: failureMessage,
      latestExecutionProfileName: run.executionProfileName ?? null,
      latestRequestedTimeoutMs: run.requestedTimeoutMs ?? null,
      latestEffectiveTimeoutMs: run.effectiveTimeoutMs,
    });
    releaseAnyTaskLock(input.repositories, task.id);

    const event: TaskEvent = {
      id: createId("task_event"),
      companyId: task.companyId,
      taskId: task.id,
      type: "task_failed",
      message: failureMessage,
      createdAt: timestamp,
      status: "failed",
      failureReason: "timeout",
      failureMessage,
      executionProfileName: run.executionProfileName ?? null,
      requestedTimeoutMs: run.requestedTimeoutMs ?? null,
      effectiveTimeoutMs: run.effectiveTimeoutMs,
      dependencyNote: null,
      artifactWorkspacePath: task.artifactWorkspacePath ?? null,
    };
    input.repositories.appendTaskEvent(event);
    events.push(event);

    const progressEvent: TaskProgressEvent = {
      id: createId("task_progress"),
      companyId: task.companyId,
      departmentId: task.departmentId,
      parentTaskId: task.parentTaskId ?? task.id,
      subjectTaskId: task.id,
      step: "blocked",
      status: "blocked",
      label: "Task timed out and is waiting for recovery.",
      detail: failureMessage,
      createdAt: timestamp,
    };
    input.repositories.appendTaskProgressEvent(progressEvent);
    progressEvents.push(progressEvent);
    reconciledTaskIds.push(task.id);
  }

  return { reconciledTaskIds, events, progressEvents };
}

export function recoverTask(input: RecoverTaskInput): RecoverTaskResult {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const timestamp = now().toISOString();
  const task = input.repositories.getTask(input.taskId);

  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  if (task.status === "running") {
    reconcileStaleRunningTasks({ ...input, companyId: task.companyId });
  }

  const currentTask = input.repositories.getTask(input.taskId);
  if (!currentTask) {
    throw new Error(`Task disappeared during recovery: ${input.taskId}`);
  }

  const proofRecoveryResult = recoverProofIfPossible(input, currentTask);
  if (proofRecoveryResult.kind === "recovered") {
    return {
      ...proofRecoveryResult.result,
      recovery: {
        status: "proof_recovered",
        message: proofRecoveryResult.result.recovery?.message ?? "Found checkable proof and submitted it to CEO Office for review.",
      },
    };
  }

  if (!isTaskRecoveryEligible(currentTask)) {
    throw new Error(`Task ${currentTask.id} cannot be recovered from status ${currentTask.status}.`);
  }

  if (currentTask.artifactWorkspacePath && !isPartialOutputFollowUpTask(currentTask)) {
    const followUpTask = createRecoveryFollowUpTask(input, currentTask, timestamp);
    const event = recordRecoveryEvent(input, currentTask, {
      message: `Recovery task created: ${followUpTask.title} will continue from Partial Output at ${currentTask.artifactWorkspacePath}.`,
      status: "failed",
      timestamp,
    });
    const progressEvent = recordRecoveryProgress(input, followUpTask, {
      label: "Recovery task queued from Partial Output.",
      status: "waiting",
      timestamp,
      detail: currentTask.latestFailureMessage ?? null,
    });

    return {
      task: currentTask,
      followUpTask,
      event,
      progressEvent,
      recovery: {
        status: "follow_up_created",
        message: "Recovery task created from Partial Output and queued for another run.",
      },
    };
  }

  input.repositories.updateTaskStatus(currentTask.id, "queued");
  input.repositories.updateTaskExecutionSummary(currentTask.id, {
    latestFailureReason: null,
    latestFailureMessage: null,
    dependencyNote: null,
  });
  const refreshedTask = input.repositories.getTask(currentTask.id);
  if (!refreshedTask) {
    throw new Error(`Task disappeared after recovery: ${currentTask.id}`);
  }
  const event = recordRecoveryEvent(input, currentTask, {
    message: `Task recovered: ${currentTask.title} is queued for another run.`,
    status: "queued",
    timestamp,
  });
  const progressEvent = recordRecoveryProgress(input, refreshedTask, {
    label: "Task recovered and queued for another run.",
    status: "waiting",
    timestamp,
    detail: null,
  });

  return {
    task: refreshedTask,
    event,
    progressEvent,
    recovery: {
      status: "queued",
      message: "Task recovered and queued for another run.",
    },
  };
}

function isTaskRecoveryEligible(task: Task): boolean {
  return task.status === "failed" || task.status === "blocked" || task.status === "needs_replan";
}

function createRecoveryFollowUpTask(input: RecoverTaskInput, failedTask: Task, timestamp: string): Task {
  const existingFollowUp = input.repositories
    .listTasksForCompany(failedTask.companyId)
    .find((task) => task.description.includes(partialOutputSourceMarker(failedTask.id)));

  if (existingFollowUp) {
    input.repositories.replaceDependencyConsumers(failedTask.id, existingFollowUp.id);
    return existingFollowUp;
  }

  const createId = input.createId ?? defaultCreateId;
  const followUpTask: Task = {
    id: createId("recovery_task"),
    companyId: failedTask.companyId,
    departmentId: failedTask.departmentId,
    keyResultId: failedTask.keyResultId,
    title: `${failedTask.title} (recovery)`,
    description: buildRecoveryFollowUpDescription(failedTask),
    assigneeAgentId: failedTask.assigneeAgentId,
    requiredCapabilities: failedTask.requiredCapabilities,
    proofSchemaId: failedTask.proofSchemaId,
    workspacePath: failedTask.artifactWorkspacePath ?? null,
    artifactWorkspacePath: failedTask.artifactWorkspacePath ?? null,
    status: "queued",
    riskLevel: failedTask.riskLevel,
    position: input.repositories.getNextTaskPosition(failedTask.companyId),
    latestFailureReason: null,
    latestFailureMessage: null,
    latestExecutionProfileName: null,
    latestRequestedTimeoutMs: null,
    latestEffectiveTimeoutMs: null,
    dependencyNote: null,
    parentTaskId: failedTask.parentTaskId ?? failedTask.id,
    taskKind: failedTask.taskKind ?? "parent",
    source: failedTask.source ?? "ceo",
  };

  input.repositories.createTask(followUpTask);
  input.repositories.replaceDependencyConsumers(failedTask.id, followUpTask.id);
  recordRecoveryProgress(input, failedTask, {
    label: `Recovery task created at ${timestamp}.`,
    status: "blocked",
    timestamp,
    detail: `Continue through ${followUpTask.title}.`,
  });

  return followUpTask;
}

function recordRecoveryEvent(
  input: RecoverTaskInput,
  task: Task,
  event: { message: string; status: Task["status"]; timestamp: string },
): TaskEvent {
  const createId = input.createId ?? defaultCreateId;
  const record: TaskEvent = {
    id: createId("task_event"),
    companyId: task.companyId,
    taskId: task.id,
    type: "task_recovered",
    message: event.message,
    createdAt: event.timestamp,
    status: event.status,
    failureReason: null,
    failureMessage: null,
    executionProfileName: task.latestExecutionProfileName ?? null,
    requestedTimeoutMs: task.latestRequestedTimeoutMs ?? null,
    effectiveTimeoutMs: task.latestEffectiveTimeoutMs ?? null,
    dependencyNote: null,
    artifactWorkspacePath: task.artifactWorkspacePath ?? null,
  };
  input.repositories.appendTaskEvent(record);
  return record;
}

function recordRecoveryProgress(
  input: RecoverTaskInput,
  task: Task,
  event: {
    label: string;
    status: TaskProgressEvent["status"];
    timestamp: string;
    detail: string | null;
  },
): TaskProgressEvent {
  const createId = input.createId ?? defaultCreateId;
  const record: TaskProgressEvent = {
    id: createId("task_progress"),
    companyId: task.companyId,
    departmentId: task.departmentId,
    parentTaskId: task.parentTaskId ?? task.id,
    subjectTaskId: task.id,
    step: "executing",
    status: event.status,
    label: event.label,
    detail: event.detail,
    createdAt: event.timestamp,
  };
  input.repositories.appendTaskProgressEvent(record);
  return record;
}

function buildRecoveryFollowUpDescription(failedTask: Task): string {
  return [
    "Continue the failed task from its Partial Output and produce valid Proof for the original proof schema.",
    "",
    partialOutputSourceMarker(failedTask.id),
    `Original Task: ${failedTask.title}`,
    `Original Proof Schema: ${failedTask.proofSchemaId}`,
    `Failure Reason: ${failedTask.latestFailureReason ?? "unknown"}`,
    `Failure Message: ${failedTask.latestFailureMessage ?? "unknown"}`,
    `Partial Output Workspace: ${failedTask.artifactWorkspacePath}`,
    "",
    "Partial Output is not Proof. Inspect and improve the existing files, keep useful work, and finish the missing deliverable.",
    "Do not mark the task complete unless you leave proof that satisfies the original proof schema.",
  ].join("\n");
}

function isPartialOutputFollowUpTask(task: Task): boolean {
  return task.description.includes("Partial Output Source Task:");
}

function partialOutputSourceMarker(taskId: string): string {
  return `Partial Output Source Task: ${taskId}`;
}

function releaseAnyTaskLock(repositories: ReturnType<typeof createRepositories>, taskId: string): void {
  const lock = repositories.listTaskLocks().find((candidate) => candidate.taskId === taskId);
  if (lock) {
    repositories.releaseTaskLock(taskId, lock.ownerId);
  }
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
