import type { TaskSummary } from "../../api/client";
import type { TranslationKey } from "../language";

export function formatTaskStatus(task: TaskSummary, t: (key: TranslationKey) => string): string {
  const details = [formatStatus(task.status, t)];

  if (task.failureReason) {
    details.push(formatTaskFailureReason(task.failureReason, t));
  }

  if (task.failureReason === "timeout" && task.effectiveTimeoutMs) {
    details.push(formatBudget(task.effectiveTimeoutMs));
  }

  if (task.dependencyNote) {
    details.push(task.dependencyNote);
  }

  if (task.artifactWorkspacePath && task.status === "failed") {
    details.push(`${t("department.partialOutput")}: ${task.artifactWorkspacePath}`);
  }

  return details.join(" · ");
}

function formatStatus(status: string, t: (key: TranslationKey) => string): string {
  switch (status) {
    case "queued":
      return t("taskStatus.queued");
    case "running":
      return t("taskStatus.running");
    case "waiting_dependency":
      return t("taskStatus.waitingDependency");
    case "retrying":
      return t("taskStatus.retrying");
    case "blocked":
      return t("taskStatus.blocked");
    case "review":
      return t("taskStatus.review");
    case "complete":
      return t("taskStatus.complete");
    case "needs_replan":
      return t("taskStatus.needsReplan");
    case "failed":
      return t("taskStatus.failed");
    case "cancelled":
      return t("taskStatus.cancelled");
    default:
      return status;
  }
}

export function formatTaskFailureReason(reason: string, t: (key: TranslationKey) => string): string {
  switch (reason) {
    case "timeout":
      return t("taskStatus.failureTimeout");
    case "agent_failed":
      return t("taskStatus.failureAgentFailed");
    case "no_proof":
      return t("taskStatus.failureNoProof");
    case "proof_capture_failed":
      return t("taskStatus.failureProofCaptureFailed");
    case "dependency_failed":
      return t("taskStatus.failureDependencyFailed");
    case "missing_deliverable":
      return t("taskStatus.missingDeliverable");
    case "missing_business_artifact":
      return t("taskStatus.failureMissingBusinessArtifact");
    case "invalid_business_artifact":
      return t("taskStatus.failureInvalidBusinessArtifact");
    case "non_reviewable_artifact":
      return t("taskStatus.failureNonReviewableArtifact");
    case "direction_drift":
      return t("taskStatus.failureDirectionDrift");
    case "stale_business_artifact":
      return t("taskStatus.failureStaleBusinessArtifact");
    case "upstream_artifact_not_accepted":
      return t("taskStatus.failureUpstreamArtifactNotAccepted");
    case "retry_exhausted":
      return t("taskStatus.failureRetryExhausted");
    case "needs_replan":
      return t("taskStatus.needsReplan");
    case "rate_limited":
      return t("taskStatus.failureRateLimited");
    default:
      return reason;
  }
}

function formatBudget(timeoutMs: number): string {
  const seconds = timeoutMs / 1000;
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
}
