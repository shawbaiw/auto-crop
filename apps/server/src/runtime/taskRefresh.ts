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
import { isAffordanceApplicable } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { isRetryExhausted, retryExhaustedRefusalMessage, terminateAsRetryExhausted } from "./boundedRecovery";
import { captureBusinessArtifact, isReviewableBusinessArtifact } from "./businessArtifact";
import { finalizeDelivery, type DeliveryOutcome } from "./deliveryFinalization";
import { resolveCaptureVerificationContext } from "./verificationContract";
import { refreshDependencyTasks } from "./dependencyCascade";
import { refreshParentTaskAggregationTask } from "./parentTaskAggregation";
import { applyTaskTransition } from "./taskTransition";
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

  if (isRetryExhausted(input.repositories, task.id)) {
    // Land it in the CEO Blocked Queue if an earlier path left it merely `failed`, then refuse.
    terminateAsRetryExhausted({
      repositories: input.repositories,
      task,
      now: input.now,
      createId: input.createId,
    });
    throw new Error(retryExhaustedRefusalMessage(task));
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

  const parentAggregationRefresh = refreshParentTaskAggregationTask({
    repositories: input.repositories,
    task,
    forceEvent: true,
    now: input.now,
    createId: input.createId,
  });

  if (parentAggregationRefresh?.event) {
    return {
      task: parentAggregationRefresh.task,
      event: parentAggregationRefresh.event,
      progressEvent: parentAggregationRefresh.progressEvent,
      recovery,
    };
  }

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

  const recovered = recoverProofFromKnownWorkspaces(input, task, proofSchema);

  if (!recovered) {
    return { kind: "not_found" };
  }

  const { proof, workspacePath } = recovered;
  for (const item of proof) {
    input.repositories.appendProof(item);
  }

  const businessArtifact = captureBusinessArtifact({
    task,
    proofs: proof,
    workspacePath,
    locale: input.repositories.getCompany(task.companyId)?.locale ?? "en",
    verificationContext: resolveCaptureVerificationContext(input.repositories, task, workspacePath),
    now: input.now,
    createId: input.createId,
  });
  input.repositories.createBusinessArtifact(businessArtifact);

  // A valid report whose verification verdict did not pass is a delivery with an outcome, not an
  // artifact to recapture: it goes to finalization like any other delivery.
  const deliveredWithVerdict = Boolean(businessArtifact.verification && businessArtifact.validationStatus === "valid");
  if (!isReviewableBusinessArtifact(businessArtifact) && !deliveredWithVerdict) {
    const now = input.now ?? (() => new Date());
    const createId = input.createId ?? defaultCreateId;
    const timestamp = now().toISOString();
    const failureReason = businessArtifactFailureReason(businessArtifact);
    const failureMessage = businessArtifactFailureMessage(task, businessArtifact);

    applyTaskTransition({
      repositories: input.repositories,
      task,
      status: "blocked",
      executionSummary: {
        latestFailureReason: failureReason,
        latestFailureMessage: failureMessage,
        dependencyNote: null,
      },
      hold: {
        kind: "invalid_business_artifact",
        subjectKind: "business_artifact",
        subjectId: businessArtifact.id,
        reason: failureMessage,
      },
      now: input.now,
      createId: input.createId,
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
      artifactWorkspacePath: task.artifactWorkspacePath ?? workspacePath,
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

  if (task.artifactWorkspacePath && task.artifactWorkspacePath !== workspacePath) {
    input.repositories.updateTaskArtifactWorkspacePath(task.id, workspacePath);
  }

  // Recovered proof is a delivery like a finished run's, and gets the same policy: failed verdicts,
  // Founder Decisions, internal subtask delivery, Automatic Acceptance or CEO review — never a shortcut.
  const finalized = finalizeDelivery({
    repositories: input.repositories,
    task: input.repositories.getTask(task.id) ?? task,
    artifact: businessArtifact,
    source: "proof_recovery",
    now: input.now,
    createId: input.createId,
  });

  return {
    kind: "recovered",
    result: {
      task: finalized.task,
      event: finalized.events.find((event) => event.taskId === task.id) ?? appendRecoveryEvent(input, finalized.task),
      ...(finalized.progressEvent ? { progressEvent: finalized.progressEvent } : {}),
      proof,
      businessArtifacts: [input.repositories.getCurrentBusinessArtifactForTask(task.id) ?? businessArtifact],
      recovery: {
        status: "recovered",
        message: recoveryMessage(finalized.outcome),
      },
    },
  };
}

/** Recovery always answers with an event; an outcome that appended none of its own gets this one. */
function appendRecoveryEvent(input: RefreshTaskDependencyStateInput, task: Task): TaskEvent {
  const createId = input.createId ?? defaultCreateId;
  const event: TaskEvent = {
    id: createId("task_event"),
    companyId: task.companyId,
    taskId: task.id,
    type: "proof_recovered",
    message: `Proof recovered: ${task.title}.`,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    status: task.status,
    failureReason: null,
    failureMessage: null,
    executionProfileName: null,
    requestedTimeoutMs: null,
    effectiveTimeoutMs: null,
    dependencyNote: null,
    artifactWorkspacePath: task.artifactWorkspacePath ?? null,
  };
  input.repositories.appendTaskEvent(event);
  return event;
}

function recoveryMessage(outcome: DeliveryOutcome): string {
  switch (outcome) {
    case "accepted":
      return "Found checkable proof; Automatic Acceptance accepted it.";
    case "awaiting_ceo_review":
      return "Found checkable proof and submitted it to CEO Office for review.";
    case "awaiting_founder_decision":
      return "Found checkable proof; it declares a Founder Decision the founder must make.";
    case "internal_delivery":
      return "Found checkable proof and delivered it to the department.";
    case "verification_failed":
      return "Found a verification report whose verdict did not pass.";
    case "held":
      return "Found checkable proof, but the task is still held for another reason.";
  }
}

function recoverProofFromKnownWorkspaces(
  input: RefreshTaskDependencyStateInput,
  task: Task,
  proofSchema: ProofSchema,
): { proof: Proof[]; workspacePath: string } | null {
  for (const workspacePath of listProofRecoveryWorkspacePaths(input.repositories, task)) {
    const proof = captureProofs({
      task,
      proofSchema,
      workspacePath,
      logPath: "",
      stdout: "",
      stderr: "",
      createId: input.createId,
    });

    if (proof.length > 0) {
      return { proof, workspacePath };
    }
  }

  return null;
}

function listProofRecoveryWorkspacePaths(
  repositories: ReturnType<typeof createRepositories>,
  task: Task,
): string[] {
  const candidates = [
    task.workspacePath,
    task.artifactWorkspacePath,
    ...repositories
      .listTaskDependencies(task.id)
      .map((dependency) => repositories.getTask(dependency.dependsOnTaskId)?.artifactWorkspacePath ?? null),
  ];
  return [...new Set(candidates.filter((path): path is string => Boolean(path)))];
}

function isProofRecoveryEligible(task: Task): boolean {
  if (task.status === "failed" && task.latestFailureReason === "no_proof") {
    return true;
  }

  return (
    task.latestFailureReason === "missing_business_artifact" ||
    task.latestFailureReason === "missing_deliverable" ||
    task.latestFailureReason === "non_reviewable_artifact"
  );
}

/** One declaration, shared with the offer: `isAffordanceApplicable` in `@auto-crop/core`. */
function isRefreshableStatus(status: TaskStatus): boolean {
  return isAffordanceApplicable("refresh_task", status);
}

function proofRecoveryNotFoundMessage(task: Task): string {
  if (task.proofSchemaId === "repo-diff") {
    return "No registerable repo-diff proof was found / repo-diff proof missing: expected .auto-crop-proof/*.diff or a top-level workspace *.diff/*.patch file; .auto-crop/business-artifact.json is not diff proof.";
  }
  return "No registerable proof was found.";
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
