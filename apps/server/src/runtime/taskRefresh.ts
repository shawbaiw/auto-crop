import type { AgentFailureReason, Proof, ProofSchema, Task, TaskEvent, TaskProgressEvent, TaskStatus } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { resolveDependencyReadiness } from "./dependencyReadiness";
import { captureProofs } from "./proof";

export type RefreshTaskDependencyStateInput = {
  repositories: ReturnType<typeof createRepositories>;
  taskId: string;
  proofSchemas?: ProofSchema[];
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export type RefreshTaskDependencyStateResult = {
  task: Task;
  event: TaskEvent;
  progressEvent?: TaskProgressEvent;
  proof?: Proof[];
  recovery?: {
    status: "recovered" | "not_found" | "not_applicable";
    message: string;
  };
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

  const recoveryResult = recoverProofIfPossible(input, task);
  if (recoveryResult.kind === "recovered") {
    return recoveryResult.result;
  }

  const readiness = resolveDependencyReadiness(input.repositories, task);
  const recovery = recoveryResult.kind === "not_applicable"
    ? { status: "not_applicable" as const, message: "Proof recovery does not apply to this task." }
    : recoveryResult.kind === "not_found"
      ? { status: "not_found" as const, message: "No registerable diff/patch proof was found." }
      : undefined;

  if (readiness.kind === "ready") {
    input.repositories.updateTaskStatus(task.id, "queued");
    input.repositories.updateTaskExecutionSummary(task.id, {
      latestFailureReason: null,
      latestFailureMessage: null,
      dependencyNote: null,
    });
    return {
      ...recordRefreshEvent(input, task, {
      type: "dependency_ready",
      message: `Task refreshed: ${task.title} is queued because dependencies are ready.`,
      status: "queued",
      failureReason: null,
      failureMessage: null,
      dependencyNote: null,
      }),
      recovery,
    };
  }

  if (readiness.kind === "waiting") {
    input.repositories.updateTaskStatus(task.id, "waiting_dependency");
    input.repositories.updateTaskExecutionSummary(task.id, {
      latestFailureReason: null,
      latestFailureMessage: null,
      dependencyNote: readiness.note,
    });
    return {
      ...recordRefreshEvent(input, task, {
      type: "dependency_waiting",
      message: readiness.note,
      status: "waiting_dependency",
      failureReason: null,
      failureMessage: null,
      dependencyNote: readiness.note,
      }),
      recovery,
    };
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
    return {
      ...recordRefreshEvent(input, task, {
      type: "deliverable_missing",
      message: failureMessage,
      status: "blocked",
      failureReason,
      failureMessage,
      dependencyNote: readiness.note,
      }),
      recovery,
    };
  }

  const failureMessage = `Task blocked: ${task.title} / ${readiness.reason} / ${readiness.dependency.title} is ${readiness.dependency.status}.`;
  input.repositories.updateTaskStatus(task.id, "blocked");
  input.repositories.updateTaskExecutionSummary(task.id, {
    latestFailureReason: readiness.reason,
    latestFailureMessage: failureMessage,
    dependencyNote: readiness.note,
  });
  return {
    ...recordRefreshEvent(input, task, {
    type: "task_blocked",
    message: failureMessage,
    status: "blocked",
    failureReason: readiness.reason,
    failureMessage,
    dependencyNote: readiness.note,
    }),
    recovery,
  };
}

function recoverProofIfPossible(
  input: RefreshTaskDependencyStateInput,
  task: Task,
):
  | { kind: "recovered"; result: RefreshTaskDependencyStateResult }
  | { kind: "not_found" }
  | { kind: "not_applicable" } {
  if (!isProofRecoveryEligible(task)) {
    return { kind: "not_applicable" };
  }

  const proofSchema = input.proofSchemas?.find((schema) => schema.id === task.proofSchemaId);
  if (!proofSchema || !task.workspacePath) {
    return { kind: "not_found" };
  }

  const proof = captureProofs({
    task,
    proofSchema,
    workspacePath: task.workspacePath,
    logPath: "",
    stdout: "",
    stderr: "",
    createId: input.createId,
  });

  if (proof.length === 0) {
    return { kind: "not_found" };
  }

  for (const item of proof) {
    input.repositories.appendProof(item);
  }

  input.repositories.updateTaskStatus(task.id, "review");
  input.repositories.updateTaskExecutionSummary(task.id, {
    latestFailureReason: null,
    latestFailureMessage: null,
    dependencyNote: null,
  });

  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const timestamp = now().toISOString();
  const event: TaskEvent = {
    id: createId("task_event"),
    companyId: task.companyId,
    taskId: task.id,
    type: "proof_recovered",
    message: `Proof recovered: ${task.title} submitted to CEO Office for review.`,
    createdAt: timestamp,
    status: "review",
    failureReason: null,
    failureMessage: null,
    executionProfileName: null,
    requestedTimeoutMs: null,
    effectiveTimeoutMs: null,
    dependencyNote: null,
    artifactWorkspacePath: task.artifactWorkspacePath ?? null,
  };
  input.repositories.appendTaskEvent(event);

  const progressEvent: TaskProgressEvent = {
    id: createId("task_progress"),
    companyId: task.companyId,
    departmentId: task.departmentId,
    parentTaskId: task.parentTaskId ?? task.id,
    subjectTaskId: task.id,
    step: "awaiting_review",
    status: "current",
    label: "Found checkable proof and submitted it to CEO Office for review.",
    detail: proof.map((item) => item.summary).join("\n"),
    createdAt: timestamp,
  };
  input.repositories.appendTaskProgressEvent(progressEvent);

  const refreshedTask = input.repositories.getTask(task.id);
  if (!refreshedTask) {
    throw new Error(`Task disappeared after proof recovery: ${task.id}`);
  }

  return {
    kind: "recovered",
    result: {
      task: refreshedTask,
      event,
      progressEvent,
      proof,
      recovery: {
        status: "recovered",
        message: "Found checkable proof and submitted it to CEO Office for review.",
      },
    },
  };
}

function isProofRecoveryEligible(task: Task): boolean {
  if (task.status === "failed" && task.latestFailureReason === "no_proof") {
    return true;
  }

  return task.latestFailureReason === "missing_deliverable";
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
