import type {
  AgentFailureReason,
  BusinessArtifact,
  Proof,
  ProofSchema,
  Task,
  TaskEvent,
  TaskProgressEvent,
  TaskStatus,
} from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { captureBusinessArtifact } from "./businessArtifact";
import { refreshDependencyTasks } from "./dependencyCascade";
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
  businessArtifacts?: BusinessArtifact[];
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

  const recovery = recoveryResult.kind === "not_applicable"
    ? { status: "not_applicable" as const, message: "Proof recovery does not apply to this task." }
    : recoveryResult.kind === "not_found"
      ? { status: "not_found" as const, message: proofRecoveryNotFoundMessage(task) }
      : undefined;

  const dependencyRefresh = refreshDependencyTasks({
    repositories: input.repositories,
    tasks: [task],
    forceEvent: true,
    ignoreCascadeEligibility: true,
    now: input.now,
    createId: input.createId,
  });

  if (dependencyRefresh.errors.length > 0) {
    throw new Error(dependencyRefresh.errors[0]!.message);
  }

  const update = dependencyRefresh.updatedTasks[0];
  if (!update?.event) {
    throw new Error(`Task ${task.id} did not produce a dependency refresh event.`);
  }

  return {
    task: update.task,
    event: update.event,
    progressEvent: update.progressEvent,
    recovery,
  };
}

export function recoverProofIfPossible(
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

  const businessArtifact = captureBusinessArtifact({
    task,
    proofs: proof,
    workspacePath: task.workspacePath,
    now: input.now,
    createId: input.createId,
  });
  input.repositories.createBusinessArtifact(businessArtifact);

  if (!isReviewableBusinessArtifact(businessArtifact)) {
    const now = input.now ?? (() => new Date());
    const createId = input.createId ?? defaultCreateId;
    const timestamp = now().toISOString();
    const failureReason = businessArtifactFailureReason(businessArtifact);
    const failureMessage = businessArtifactFailureMessage(task, businessArtifact);

    input.repositories.updateTaskStatus(task.id, "blocked");
    input.repositories.updateTaskExecutionSummary(task.id, {
      latestFailureReason: failureReason,
      latestFailureMessage: failureMessage,
      dependencyNote: null,
    });

    const event: TaskEvent = {
      id: createId("task_event"),
      companyId: task.companyId,
      taskId: task.id,
      type: "task_blocked",
      message: failureMessage,
      createdAt: timestamp,
      status: "blocked",
      failureReason,
      failureMessage,
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
      step: "blocked",
      status: "blocked",
      label: failureMessage,
      detail: businessArtifact.validationErrors.join("\n") || null,
      createdAt: timestamp,
    };
    input.repositories.appendTaskProgressEvent(progressEvent);

    const refreshedTask = input.repositories.getTask(task.id);
    if (!refreshedTask) {
      throw new Error(`Task disappeared after business artifact recovery gate: ${task.id}`);
    }

    return {
      kind: "recovered",
      result: {
        task: refreshedTask,
        event,
        progressEvent,
        proof,
        businessArtifacts: [businessArtifact],
        recovery: {
          status: "recovered",
          message: "Found checkable proof, but blocked before CEO review because the business artifact is not reviewable.",
        },
      },
    };
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
      businessArtifacts: [businessArtifact],
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

function proofRecoveryNotFoundMessage(task: Task): string {
  if (task.proofSchemaId === "repo-diff") {
    return "No registerable repo-diff proof was found / repo-diff proof missing: expected .auto-crop-proof/*.diff or a top-level workspace *.diff/*.patch file; .auto-crop/business-artifact.json is not diff proof.";
  }
  return "No registerable proof was found.";
}

function isReviewableBusinessArtifact(artifact: BusinessArtifact): boolean {
  return (
    artifact.isCurrent &&
    artifact.validationStatus === "valid" &&
    artifact.reviewStatus === "unreviewed" &&
    (artifact.artifactKind === "deliverable" || artifact.artifactKind === "final_report")
  );
}

function businessArtifactFailureReason(artifact: BusinessArtifact): AgentFailureReason {
  if (artifact.validationStatus === "invalid_drift") {
    return "direction_drift";
  }
  if (artifact.validationStatus === "stale" || !artifact.isCurrent) {
    return "stale_business_artifact";
  }
  if (artifact.validationStatus !== "valid") {
    return hasArtifactReason(artifact, "missing_business_artifact_file")
      ? "missing_business_artifact"
      : "invalid_business_artifact";
  }
  return "non_reviewable_artifact";
}

function businessArtifactFailureMessage(task: Task, artifact: BusinessArtifact): string {
  const errors = artifact.validationErrors.length > 0 ? ` / ${JSON.stringify(artifact.validationErrors)}` : "";
  return `Task blocked: ${task.title} / ${businessArtifactFailureReason(artifact)} / ${artifact.artifactKind}/${artifact.artifactRole}/${artifact.artifactSubtype}${errors}.`;
}

function hasArtifactReason(artifact: BusinessArtifact, reason: string): boolean {
  return (
    typeof artifact.payload === "object" &&
    artifact.payload !== null &&
    !Array.isArray(artifact.payload) &&
    "reason" in artifact.payload &&
    artifact.payload.reason === reason
  );
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
