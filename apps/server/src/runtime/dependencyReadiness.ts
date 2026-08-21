import type { Proof, Task } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { getHandoffPackageManifestPath } from "./proof";

export type TaskHandoff = {
  upstreamTaskId: string;
  upstreamTaskTitle: string;
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
        note: `Waiting for dependency deliverable: ${upstream.title} (${upstream.status}).`,
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

    const proofs = repositories.listProofsForTask(upstream.id);

    if (proofs.length === 0) {
      return {
        kind: "missing_deliverable",
        note: `Missing consumable proof from dependency: ${upstream.title}.`,
        dependency: upstream,
      };
    }

    handoffs.push(...proofs.map((proof) => createTaskHandoff(upstream, proof, dependency.handoffContract ?? null)));
  }

  return { kind: "ready", handoffs };
}

function isWaitingStatus(status: Task["status"]): boolean {
  return status === "queued" || status === "waiting_dependency" || status === "running" || status === "retrying";
}

function isFailedDependencyStatus(status: Task["status"]): boolean {
  return status === "failed" || status === "blocked" || status === "cancelled";
}

function createTaskHandoff(task: Task, proof: Proof, handoffContract: string | null): TaskHandoff {
  return {
    upstreamTaskId: task.id,
    upstreamTaskTitle: task.title,
    proofId: proof.id,
    proofType: proof.type,
    uri: proof.uri,
    summary: proof.summary,
    artifactWorkspacePath: task.artifactWorkspacePath ?? null,
    handoffContract,
    handoffPackagePath: getHandoffPackageManifestPath(task),
  };
}
