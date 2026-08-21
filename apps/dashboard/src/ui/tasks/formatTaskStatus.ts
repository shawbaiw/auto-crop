import type { TaskSummary } from "../../api/client";
import type { TranslationKey } from "../language";

export function formatTaskStatus(task: TaskSummary, t: (key: TranslationKey) => string): string {
  const coordinationStatus = formatCoordinationStatus(task.status, t);

  if (coordinationStatus) {
    return coordinationStatus;
  }

  const details = [task.status];

  if (task.failureReason) {
    details.push(formatFailureReason(task.failureReason, t));
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

function formatCoordinationStatus(status: string, t: (key: TranslationKey) => string): string | null {
  switch (status) {
    case "waiting_dependency":
      return t("taskStatus.waitingDependency");
    case "retrying":
      return t("taskStatus.retrying");
    case "needs_replan":
      return t("taskStatus.needsReplan");
    default:
      return null;
  }
}

function formatFailureReason(reason: string, t: (key: TranslationKey) => string): string {
  switch (reason) {
    case "missing_deliverable":
      return t("taskStatus.missingDeliverable");
    case "needs_replan":
      return t("taskStatus.needsReplan");
    default:
      return reason;
  }
}

function formatBudget(timeoutMs: number): string {
  const seconds = timeoutMs / 1000;
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
}
