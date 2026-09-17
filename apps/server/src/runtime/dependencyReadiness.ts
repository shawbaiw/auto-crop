import { isVerificationSatisfied, type BusinessArtifact, type Proof, type Task } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { collectFounderDecisions } from "./ceoAttention";
import { getHandoffPackageManifestPath } from "./proof";
import { isVerificationCurrent } from "./verificationContract";

export type TaskHandoff = {
  upstreamTaskId: string;
  upstreamTaskTitle: string;
  businessArtifactId: string;
  artifactKind: BusinessArtifact["artifactKind"];
  artifactRole: BusinessArtifact["artifactRole"];
  artifactSubtype: string;
  artifactType: BusinessArtifact["artifactType"];
  taskType: string;
  payload: unknown;
  lineage: unknown;
  proofId: string;
  proofType: Proof["type"];
  uri: string;
  summary: string;
  artifactWorkspacePath: string | null;
  handoffContract: string | null;
  handoffPackagePath: string | null;
};

export type DependencyReadiness =
  | { kind: "ready"; handoffs: TaskHandoff[] }
  /**
   * `dependency` is the upstream task being waited on, and `founderDecisionId` the decision parking
   * it when `waitingOnDecision` is set. Both exist so a Task Hold can name what it waits on instead
   * of restating the note (ADR 0020).
   */
  | { kind: "waiting"; note: string; dependency: Task; waitingOnDecision?: boolean; founderDecisionId?: string | null }
  | { kind: "blocked"; reason: "dependency_failed" | "needs_replan"; note: string; dependency: Task }
  | { kind: "missing_deliverable"; note: string; dependency: Task };

export function resolveDependencyReadiness(
  repositories: ReturnType<typeof createRepositories>,
  task: Task,
): DependencyReadiness {
  const dependencies = repositories.listTaskDependencies(task.id);
  const handoffs: TaskHandoff[] = [];

  for (const dependency of dependencies) {
    const upstream = repositories.getTask(dependency.dependsOnTaskId);

    if (!upstream) {
      continue;
    }

    const relation = classifyDependency(task, upstream);
    if (relation === "cross_company") {
      return {
        kind: "blocked",
        reason: "dependency_failed",
        note: `Refused dependency across companies: ${upstream.title}.`,
        dependency: upstream,
      };
    }
    if (relation === "internal") {
      const internal = resolveInternalDependency(repositories, upstream, dependency.handoffContract ?? null);
      if (internal.kind !== "ready") {
        return internal;
      }
      handoffs.push(internal.handoff);
      continue;
    }

    if (isWaitingStatus(upstream.status)) {
      const pendingDecision = waitingOnFounderDecision(repositories, upstream);
      if (pendingDecision) {
        return {
          kind: "waiting",
          note: pendingDecision.note,
          dependency: upstream,
          waitingOnDecision: true,
          founderDecisionId: pendingDecision.founderDecisionId,
        };
      }
      return {
        kind: "waiting",
        note: formatDependencyWaitingNote(upstream),
        dependency: upstream,
      };
    }

    if (upstream.status === "needs_replan") {
      return {
        kind: "blocked",
        reason: "needs_replan",
        note: `Waiting for dependency to be replanned: ${upstream.title}.`,
        dependency: upstream,
      };
    }

    if (isFailedDependencyStatus(upstream.status)) {
      return {
        kind: "blocked",
        reason: "dependency_failed",
        note: `Blocked by failed dependency: ${upstream.title}.`,
        dependency: upstream,
      };
    }

    if (upstream.status !== "complete") {
      return {
        kind: "waiting",
        note: formatDependencyWaitingNote(upstream),
        dependency: upstream,
      };
    }

    const artifact = repositories.getCurrentBusinessArtifactForTask(upstream.id);
    if (!isAcceptedBusinessArtifact(artifact)) {
      return {
        kind: "missing_deliverable",
        note: `Missing accepted business artifact from dependency: ${upstream.title}.`,
        dependency: upstream,
      };
    }

    if (!isVerificationCurrent(repositories, artifact)) {
      return {
        kind: "missing_deliverable",
        note: `Verification by ${upstream.title} covers an output that has since been superseded.`,
        dependency: upstream,
      };
    }

    const sourceProof = artifact.sourceProofId ? repositories.listProofsForTask(upstream.id).find((proof) => proof.id === artifact.sourceProofId) : null;
    handoffs.push(createTaskHandoff(upstream, artifact, sourceProof ?? null, dependency.handoffContract ?? null));
  }

  return { kind: "ready", handoffs };
}

/**
 * Whether a dependency is department-internal consumption or ordinary consumption.
 *
 * A department subtask's output is internal: its siblings under the same parent and the parent itself
 * consume it without CEO Office acceptance, because CEO Office reviews the parent's summarized result
 * (ADR 0007). Everything else — including a subtask consumed from outside its parent — is ordinary and
 * needs an accepted artifact. Kept in this one resolver so dispatch, parent aggregation, the dependency
 * cascade and Hold reconciliation cannot answer "is it ready?" differently for the same facts.
 */
export function classifyDependency(consumer: Task, upstream: Task): "internal" | "ordinary" | "cross_company" {
  if (consumer.companyId !== upstream.companyId) {
    return "cross_company";
  }
  if ((upstream.taskKind ?? "parent") !== "department_subtask" || !upstream.parentTaskId) {
    return "ordinary";
  }
  const consumerIsParent = consumer.id === upstream.parentTaskId;
  const consumerIsSibling =
    (consumer.taskKind ?? "parent") === "department_subtask" && consumer.parentTaskId === upstream.parentTaskId;
  return consumerIsParent || consumerIsSibling ? "internal" : "ordinary";
}

/**
 * Internal readiness: the subtask delivered a current, valid artifact with Proof, any verification it
 * carries passed against still-current targets, and nothing but the parent's own aggregation holds it.
 * `review` plus Proof alone is not enough — a genuine Founder Decision, a CEO review Hold, or a failed
 * verification still stops consumption.
 */
function resolveInternalDependency(
  repositories: ReturnType<typeof createRepositories>,
  upstream: Task,
  handoffContract: string | null,
): { kind: "ready"; handoff: TaskHandoff } | Exclude<DependencyReadiness, { kind: "ready" }> {
  if (upstream.status === "needs_replan") {
    return {
      kind: "blocked",
      reason: "needs_replan",
      note: `Waiting for department subtask to be replanned: ${upstream.title}.`,
      dependency: upstream,
    };
  }
  if (isFailedDependencyStatus(upstream.status)) {
    return {
      kind: "blocked",
      reason: "dependency_failed",
      note: `Blocked by department subtask: ${upstream.title} (${upstream.status}).`,
      dependency: upstream,
    };
  }
  if (upstream.status !== "review" && upstream.status !== "complete") {
    return {
      kind: "waiting",
      note: `Waiting for department subtask deliverable: ${upstream.title} (${upstream.status}).`,
      dependency: upstream,
    };
  }

  const pendingDecision = waitingOnFounderDecision(repositories, upstream);
  if (pendingDecision) {
    return {
      kind: "waiting",
      note: pendingDecision.note,
      dependency: upstream,
      waitingOnDecision: true,
      founderDecisionId: pendingDecision.founderDecisionId,
    };
  }
  const otherHold = repositories
    .listOpenTaskHolds(upstream.id)
    .find((hold) => hold.kind !== "awaiting_parent_aggregation");
  if (otherHold) {
    return {
      kind: "waiting",
      note: `Waiting for department subtask: ${upstream.title} (${otherHold.kind}).`,
      dependency: upstream,
    };
  }

  const artifact = repositories.getCurrentBusinessArtifactForTask(upstream.id);
  const proofs = repositories.listProofsForTask(upstream.id);
  if (
    !artifact ||
    proofs.length === 0 ||
    !artifact.isCurrent ||
    artifact.validationStatus !== "valid" ||
    (artifact.artifactKind !== "deliverable" && artifact.artifactKind !== "final_report")
  ) {
    return {
      kind: "missing_deliverable",
      note: `Missing department subtask proof: ${upstream.title}.`,
      dependency: upstream,
    };
  }
  if (!isVerificationSatisfied(artifact) || !isVerificationCurrent(repositories, artifact)) {
    return {
      kind: "missing_deliverable",
      note: `Department subtask verification does not cover the current output: ${upstream.title}.`,
      dependency: upstream,
    };
  }

  const sourceProof = artifact.sourceProofId ? proofs.find((proof) => proof.id === artifact.sourceProofId) : null;
  return { kind: "ready", handoff: createTaskHandoff(upstream, artifact, sourceProof ?? proofs[0] ?? null, handoffContract) };
}

/**
 * A downstream task blocked on an upstream deliverable that is parked on an unresolved Founder
 * Decision reads as "waiting on decision", not as an ordinary dependency wait. Derived — no new
 * persisted `Task` status: an upstream in `review` with a Task Completion Event still carrying a
 * `pending` Founder Decision (no resolution row) is the whole condition.
 */
function waitingOnFounderDecision(
  repositories: ReturnType<typeof createRepositories>,
  upstream: Task,
): { note: string; founderDecisionId: string | null } | null {
  if (upstream.status !== "review") {
    return null;
  }
  const events = repositories.listTaskCompletionEventsForTask(upstream.id);
  const resolutionsById = new Map(
    repositories
      .listFounderDecisionResolutionsForCompany(upstream.companyId)
      .map((resolution) => [resolution.founderDecisionId, resolution]),
  );
  const pending = events
    .flatMap((event) => collectFounderDecisions(event, resolutionsById))
    .filter((decision) => decision.status === "pending");
  if (pending.length === 0) {
    return null;
  }
  return {
    note: `Waiting on founder decision: ${pending[0]!.decisionKind.replace(/_/g, " ")}.`,
    founderDecisionId: pending[0]!.id ?? null,
  };
}

function isWaitingStatus(status: Task["status"]): boolean {
  return status === "queued" || status === "waiting_dependency" || status === "running" || status === "retrying" || status === "review";
}

function isFailedDependencyStatus(status: Task["status"]): boolean {
  return status === "failed" || status === "blocked" || status === "cancelled";
}

function isAcceptedBusinessArtifact(artifact: BusinessArtifact | null): artifact is BusinessArtifact {
  return (
    artifact !== null &&
    artifact.isCurrent &&
    artifact.validationStatus === "valid" &&
    artifact.reviewStatus === "accepted" &&
    isVerificationSatisfied(artifact) &&
    (artifact.artifactKind === "deliverable" || artifact.artifactKind === "final_report")
  );
}

function formatDependencyWaitingNote(task: Task): string {
  if (task.status === "review") {
    return `Waiting for dependency acceptance: ${task.title} (review).`;
  }

  return `Waiting for dependency deliverable: ${task.title} (${task.status}).`;
}

function createTaskHandoff(
  task: Task,
  artifact: BusinessArtifact,
  proof: Proof | null,
  handoffContract: string | null,
): TaskHandoff {
  return {
    upstreamTaskId: task.id,
    upstreamTaskTitle: task.title,
    businessArtifactId: artifact.id,
    artifactKind: artifact.artifactKind,
    artifactRole: artifact.artifactRole,
    artifactSubtype: artifact.artifactSubtype,
    artifactType: artifact.artifactType,
    taskType: artifact.taskType,
    payload: artifact.payload,
    lineage: artifact.lineage,
    proofId: proof?.id ?? "",
    proofType: proof?.type ?? "file",
    uri: proof?.uri ?? "",
    summary: proof?.summary ?? `Accepted business artifact: ${artifact.artifactType}.`,
    artifactWorkspacePath: task.artifactWorkspacePath ?? null,
    handoffContract,
    handoffPackagePath: getHandoffPackageManifestPath(task),
  };
}
