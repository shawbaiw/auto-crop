import type { BusinessArtifact, Task } from "@auto-crop/core";

export type AutomaticAcceptanceDecision =
  | { kind: "accept" }
  | { kind: "requires_review"; reason: string };

const FORBIDDEN_RISK_PATTERNS = [
  /\bpublic\b/i,
  /\blaunch\b/i,
  /\bpublish\b/i,
  /\bdeploy/i,
  /\bproduction\b/i,
  /\bdomain\b/i,
  /\bsearch console\b/i,
  /\bads?\b/i,
  /\badvertis/i,
  /\bspend\b/i,
  /\bpayment\b/i,
  /\bbilling\b/i,
  /\bsubscription\b/i,
  /\blegal\b/i,
  /\bcompliance\b/i,
  /\buser data\b/i,
  /\bpersonal data\b/i,
  /\bcredential\b/i,
  /\bapi key\b/i,
  /\bpassword\b/i,
  /\bsecret\b/i,
  /\baccount\b/i,
  /\bpermission\b/i,
  /\boauth\b/i,
  /\birreversible\b/i,
  /\bdirection change\b/i,
  /\bpivot\b/i,
] as const;

export function evaluateAutomaticAcceptance(input: {
  artifact: BusinessArtifact | null;
  task: Task;
}): AutomaticAcceptanceDecision {
  if (input.task.riskLevel !== "low") {
    return { kind: "requires_review", reason: "non_low_risk" };
  }

  if (!input.artifact || !isReviewableBusinessArtifact(input.artifact)) {
    return { kind: "requires_review", reason: "artifact_not_reviewable" };
  }

  if (!isMarkedForInternalAutomaticAcceptance(input.artifact.payload)) {
    return { kind: "requires_review", reason: "not_marked_internal_automatic_acceptance" };
  }

  const riskText = [
    input.task.title,
    input.task.description,
    input.task.proofSchemaId,
    input.artifact.artifactKind,
    input.artifact.artifactRole,
    input.artifact.artifactSubtype,
    input.artifact.artifactType,
    input.artifact.taskType,
    JSON.stringify(input.artifact.payload),
  ].join("\n");

  if (FORBIDDEN_RISK_PATTERNS.some((pattern) => pattern.test(riskText))) {
    return { kind: "requires_review", reason: "external_or_sensitive_risk" };
  }

  return { kind: "accept" };
}

function isMarkedForInternalAutomaticAcceptance(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  if (payload.autoAccept === true || payload.auto_accept === true) {
    return true;
  }

  const acceptance = payload.acceptance;
  if (!isRecord(acceptance)) {
    return false;
  }

  return (acceptance.mode === "automatic" || acceptance.mode === "auto") && acceptance.scope === "internal";
}

function isReviewableBusinessArtifact(artifact: BusinessArtifact): boolean {
  return (
    artifact.isCurrent &&
    artifact.validationStatus === "valid" &&
    artifact.reviewStatus === "unreviewed" &&
    (artifact.artifactKind === "deliverable" || artifact.artifactKind === "final_report")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
