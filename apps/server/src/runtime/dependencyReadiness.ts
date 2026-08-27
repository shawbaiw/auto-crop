import type { BusinessArtifact, Proof, Task } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { getHandoffPackageManifestPath } from "./proof";

export type TaskHandoff = {
  upstreamTaskId: string;
  upstreamTaskTitle: string;
  businessArtifactId: string;
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
  | { kind: "waiting"; note: string }
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
    artifact.artifactType !== "blocker_report" &&
    artifact.artifactType !== "direction_change_request"
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
