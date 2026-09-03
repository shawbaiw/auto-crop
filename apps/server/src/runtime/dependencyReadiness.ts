import type { BusinessArtifact, Proof, Task } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { collectFounderDecisions } from "./ceoAttention";
import { getHandoffPackageManifestPath } from "./proof";

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
  | { kind: "waiting"; note: string; waitingOnDecision?: boolean }
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

    if (isWaitingStatus(upstream.status)) {
      const decisionNote = waitingOnFounderDecisionNote(repositories, upstream);
      if (decisionNote) {
        return { kind: "waiting", note: decisionNote, waitingOnDecision: true };
      }
      return {
        kind: "waiting",
        note: formatDependencyWaitingNote(upstream),
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

    const sourceProof = artifact.sourceProofId ? repositories.listProofsForTask(upstream.id).find((proof) => proof.id === artifact.sourceProofId) : null;
    handoffs.push(createTaskHandoff(upstream, artifact, sourceProof ?? null, dependency.handoffContract ?? null));
  }

  return { kind: "ready", handoffs };
}

/**
 * A downstream task blocked on an upstream deliverable that is parked on an unresolved Founder
 * Decision reads as "waiting on decision", not as an ordinary dependency wait. Derived — no new
 * persisted `Task` status: an upstream in `review` with a Task Completion Event still carrying a
 * `pending` Founder Decision (no resolution row) is the whole condition.
 */
function waitingOnFounderDecisionNote(
  repositories: ReturnType<typeof createRepositories>,
  upstream: Task,
): string | null {
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
  return `Waiting on founder decision: ${pending[0]!.decisionKind.replace(/_/g, " ")}.`;
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
