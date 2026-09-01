import type { TranslationKey } from "../language";

type Translate = (key: TranslationKey) => string;

export function formatProofType(type: string, t: Translate): string {
  switch (type) {
    case "file":
      return t("display.proofTypeFile");
    case "diff":
      return t("display.proofTypeDiff");
    case "url":
      return t("display.proofTypeUrl");
    case "screenshot":
      return t("display.proofTypeScreenshot");
    case "command_output":
      return t("display.proofTypeCommandOutput");
    case "test_result":
      return t("display.proofTypeTestResult");
    case "deployment":
      return t("display.proofTypeDeployment");
    default:
      return formatCodeLabel(type);
  }
}

export function formatArtifactKind(kind: string, t: Translate): string {
  switch (kind) {
    case "deliverable":
      return t("display.artifactKindDeliverable");
    case "blocker":
      return t("display.artifactKindBlocker");
    case "decision_request":
      return t("display.artifactKindDecisionRequest");
    case "direction_change_request":
      return t("display.artifactKindDirectionChangeRequest");
    case "final_report":
      return t("display.artifactKindFinalReport");
    default:
      return formatCodeLabel(kind);
  }
}

export function formatArtifactRole(role: string, t: Translate): string {
  switch (role) {
    case "findings":
      return t("display.artifactRoleFindings");
    case "plan":
      return t("display.artifactRolePlan");
    case "spec":
      return t("display.artifactRoleSpec");
    case "implementation":
      return t("display.artifactRoleImplementation");
    case "validation":
      return t("display.artifactRoleValidation");
    case "launch":
      return t("display.artifactRoleLaunch");
    case "report":
      return t("display.artifactRoleReport");
    case "none":
      return t("display.artifactRoleNone");
    default:
      return formatCodeLabel(role);
  }
}

export function formatArtifactValidationStatus(status: string, t: Translate): string {
  switch (status) {
    case "pending":
      return t("display.validationPending");
    case "valid":
      return t("display.validationValid");
    case "invalid_schema":
      return t("display.validationInvalidSchema");
    case "invalid_blocker":
      return t("display.validationInvalidBlocker");
    case "invalid_drift":
      return t("display.validationInvalidDrift");
    case "stale":
      return t("display.validationStale");
    default:
      return formatCodeLabel(status);
  }
}

export function formatArtifactReviewStatus(status: string, t: Translate): string {
  switch (status) {
    case "unreviewed":
      return t("display.reviewUnreviewed");
    case "accepted":
      return t("display.reviewAccepted");
    case "returned":
      return t("display.reviewReturned");
    case "not_reviewable":
      return t("display.reviewNotReviewable");
    default:
      return formatCodeLabel(status);
  }
}

export function formatCompanyStatus(status: string, t: Translate): string {
  switch (status) {
    case "draft":
      return t("display.companyStatusDraft");
    case "active":
      return t("display.companyStatusActive");
    case "paused":
      return t("display.companyStatusPaused");
    case "review":
      return t("display.companyStatusReview");
    default:
      return formatCodeLabel(status);
  }
}

export function formatReplanProposalStatus(status: string, t: Translate): string {
  switch (status) {
    case "proposed":
      return t("display.replanStatusProposed");
    case "confirmed":
      return t("display.replanStatusConfirmed");
    case "dismissed":
      return t("display.replanStatusDismissed");
    default:
      return formatCodeLabel(status);
  }
}

export function formatCapability(capability: string, t: Translate): string {
  switch (capability) {
    case "code":
      return t("display.capabilityCode");
    case "frontend":
      return t("display.capabilityFrontend");
    case "test":
      return t("display.capabilityTest");
    case "writing":
      return t("display.capabilityWriting");
    case "research":
      return t("display.capabilityResearch");
    case "growth":
      return t("display.capabilityGrowth");
    default:
      return formatCodeLabel(capability);
  }
}

export function formatCurrentFlag(isCurrent: boolean, t: Translate): string {
  return isCurrent ? t("display.current") : "";
}

export function formatCodeLabel(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
