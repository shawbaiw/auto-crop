import type { ReplanBasis, ReplanProposal, Task, VerificationRequirement } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { parseUnblockRequest, type UnblockRequest } from "./unblockRequest";
import {
  dependenciesWithRole,
  fingerprintRequirements,
  isVerifyingTask,
  resolveVerificationRequirementSource,
  verifiersOf,
} from "./verificationContract";

type Repositories = ReturnType<typeof createRepositories>;

/**
 * The verifiers whose standard a Revision of `task` touches: every verifier that judges it, and the task
 * itself when it is a verifier. A Revision may amend the planned requirements of any of them.
 */
export function verifiersJudging(repositories: Repositories, task: Task): Task[] {
  const verifiers = verifiersOf(repositories, task.id);
  return isVerifyingTask(repositories, task) && !verifiers.some((verifier) => verifier.id === task.id)
    ? [task, ...verifiers]
    : verifiers;
}

/**
 * Which of those standards a Revision may edit. Requirements planned onto a verifier are the plan's,
 * and a Revision may amend them. Requirements a verifier takes from a `verification_requirements`
 * producer are that producer's delivery: editing them here would be editing an artifact, so the
 * proposal points at revising the producer instead (ADR 0043).
 */
export function revisableRequirements(repositories: Repositories, task: Task): {
  editable: Array<{ verifier: Task; requirements: VerificationRequirement[] }>;
  sourced: Array<{ verifier: Task; producer: Task }>;
} {
  const editable: Array<{ verifier: Task; requirements: VerificationRequirement[] }> = [];
  const sourced: Array<{ verifier: Task; producer: Task }> = [];
  for (const verifier of verifiersJudging(repositories, task)) {
    const [source] = dependenciesWithRole(repositories, verifier.id, "verification_requirements");
    const producer = source ? repositories.getTask(source.dependsOnTaskId) : null;
    if (producer) {
      sourced.push({ verifier, producer });
    } else if ((verifier.verificationRequirements ?? []).length > 0) {
      editable.push({ verifier, requirements: verifier.verificationRequirements! });
    }
  }
  return { editable, sourced };
}

/** Why a task is stuck, as the replan planner is told it (ADR 0043). */
export type StuckContext = {
  holds: Array<{ kind: string; reason: string }>;
  blocker: { subtype: string; payload: unknown; unblockRequest: UnblockRequest | null } | null;
  failedVerdicts: Array<{
    verifierTitle: string;
    outcome: string;
    issues: string[];
    checks: Array<{ requirementId: string; description: string; outcome: string; evidence: string }>;
  }>;
  lastRejection: { rationale: string; note: string | null } | null;
};

export function resolveStuckContext(repositories: Repositories, task: Task): StuckContext {
  const current = repositories.getCurrentBusinessArtifactForTask(task.id);
  const failedVerdicts = verifiersJudging(repositories, task).flatMap((verifier) => {
    const verification = repositories.getCurrentBusinessArtifactForTask(verifier.id)?.verification;
    if (!verification || verification.outcome === "passed") {
      return [];
    }
    const describe = (requirementId: string) =>
      verification.requirements.find((requirement) => requirement.id === requirementId)?.description ?? requirementId;
    return [{
      verifierTitle: verifier.title,
      outcome: verification.outcome,
      issues: verification.issues,
      checks: verification.checks
        .filter((check) => check.outcome !== "passed")
        // A verifier judging several targets: only what it found at fault in this one, or in no one.
        .filter((check) => verifier.id === task.id || !check.targetTaskId || check.targetTaskId === task.id)
        .map((check) => ({ requirementId: check.requirementId, description: describe(check.requirementId), outcome: check.outcome, evidence: check.evidence })),
    }];
  });
  const lastRejected = repositories.listReplanProposalsForTask(task.id).filter((proposal) => proposal.status === "rejected").at(-1);

  return {
    holds: repositories.listOpenTaskHolds(task.id).map((hold) => ({ kind: hold.kind, reason: hold.reason })),
    blocker: current?.artifactKind === "blocker"
      ? { subtype: current.artifactSubtype, payload: current.payload, unblockRequest: parseUnblockRequest(current.payload).request }
      : null,
    failedVerdicts,
    lastRejection: lastRejected ? { rationale: lastRejected.rationale, note: lastRejected.rejectionNote } : null,
  };
}

/**
 * The task state a proposal is made from, and confirmed against. Everything that, having changed, means
 * the planner reasoned about a different task: its status and open Holds (a Human Action confirmed), its
 * runs (a recovery), its delivery, its upstream deliveries (an upstream redelivered), and the verdicts
 * and standards that judge it.
 */
export function resolveReplanBasis(repositories: Repositories, task: Task): ReplanBasis {
  const verifiers = verifiersJudging(repositories, task);
  return {
    taskStatus: task.status,
    openHoldIds: repositories.listOpenTaskHolds(task.id).map((hold) => hold.id).sort(),
    currentArtifactId: repositories.getCurrentBusinessArtifactForTask(task.id)?.id ?? null,
    runCount: repositories.countAllAgentRunsForTask(task.id),
    upstreamArtifactIds: Object.fromEntries(repositories.listTaskDependencies(task.id)
      .map((dependency) => [dependency.dependsOnTaskId, repositories.getCurrentBusinessArtifactForTask(dependency.dependsOnTaskId)?.id ?? null])),
    verdictArtifactIds: Object.fromEntries(verifiers
      .map((verifier) => [verifier.id, repositories.getCurrentBusinessArtifactForTask(verifier.id)?.id ?? null])),
    requirementFingerprints: Object.fromEntries(verifiers.map((verifier) => {
      const source = resolveVerificationRequirementSource(repositories, verifier);
      return [verifier.id, source.kind === "resolved" ? fingerprintRequirements(source.requirements) : null];
    })),
  };
}

/**
 * Whether a proposal still describes its task. Derived by comparing what it recorded with the present —
 * the same way verdict currency is — so nothing has to remember to mark a proposal stale.
 */
export function isReplanProposalCurrent(repositories: Repositories, proposal: ReplanProposal): boolean {
  const task = repositories.getTask(proposal.sourceTaskId);
  if (!task || !proposal.basis) {
    return false;
  }
  return stableJson(resolveReplanBasis(repositories, task)) === stableJson(proposal.basis);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
