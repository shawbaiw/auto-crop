import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BusinessArtifact,
  BusinessArtifactKind,
  BusinessArtifactRole,
  BusinessArtifactType,
  Proof,
  Task,
} from "@auto-crop/core";

const BUSINESS_ARTIFACT_PATH = join(".auto-crop", "business-artifact.json");
const BUSINESS_ARTIFACT_KINDS = new Set<BusinessArtifactKind>([
  "deliverable",
  "blocker",
  "decision_request",
  "direction_change_request",
  "final_report",
]);
const BUSINESS_ARTIFACT_ROLES = new Set<BusinessArtifactRole>([
  "findings",
  "plan",
  "spec",
  "implementation",
  "validation",
  "launch",
  "report",
  "none",
]);
const BUSINESS_ARTIFACT_TYPES = new Set<BusinessArtifactType>([
  "research_findings",
  "product_mvp_brief",
  "implementation_summary",
  "validation_result",
  "preview_result",
  "launch_plan",
  "deployment_result",
  "final_founder_report",
  "blocker_report",
  "direction_change_request",
]);

type DeclaredBusinessArtifact = {
  artifactKind: BusinessArtifactKind;
  artifactRole: BusinessArtifactRole;
  artifactSubtype: string;
  artifactType: BusinessArtifactType;
  taskType: string;
  sourceProofId?: string;
  payload: unknown;
  lineage: unknown;
};

export type CaptureBusinessArtifactInput = {
  task: Task;
  proofs: Proof[];
  workspacePath: string;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export function captureBusinessArtifact(input: CaptureBusinessArtifactInput): BusinessArtifact {
  const timestamp = (input.now ?? (() => new Date()))().toISOString();
  const id = input.createId?.("business_artifact") ?? `business_artifact_${crypto.randomUUID()}`;
  const sourcePath = join(input.workspacePath, BUSINESS_ARTIFACT_PATH);

  if (!existsSync(sourcePath)) {
    return {
      id,
      companyId: input.task.companyId,
      taskId: input.task.id,
      sourceProofId: input.proofs[0]?.id ?? null,
      artifactKind: "blocker",
      artifactRole: "none",
      artifactSubtype: "missing_business_artifact_file",
      artifactType: "blocker_report",
      taskType: inferTaskType(input.task),
      payload: {
        reason: "missing_business_artifact_file",
        expectedPath: BUSINESS_ARTIFACT_PATH,
      },
      lineage: {},
      validationStatus: "invalid_schema",
      validationErrors: [`Missing ${BUSINESS_ARTIFACT_PATH}.`],
      reviewStatus: "not_reviewable",
      isCurrent: true,
      supersedesArtifactId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  const raw = readFileSync(sourcePath, "utf8");
  const parsed = parseDeclaredBusinessArtifact(raw, input.task);
  if (!parsed.success) {
    return {
      id,
      companyId: input.task.companyId,
      taskId: input.task.id,
      sourceProofId: input.proofs[0]?.id ?? null,
      artifactKind: "blocker",
      artifactRole: "none",
      artifactSubtype: "invalid_business_artifact_schema",
      artifactType: "blocker_report",
      taskType: inferTaskType(input.task),
      payload: {
        reason: "invalid_business_artifact_schema",
        expectedPath: BUSINESS_ARTIFACT_PATH,
      },
      lineage: {},
      validationStatus: "invalid_schema",
      validationErrors: parsed.errors,
      reviewStatus: "not_reviewable",
      isCurrent: true,
      supersedesArtifactId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  return {
    id,
    companyId: input.task.companyId,
    taskId: input.task.id,
    sourceProofId: parsed.value.sourceProofId ?? input.proofs[0]?.id ?? null,
    artifactKind: parsed.value.artifactKind,
    artifactRole: parsed.value.artifactRole,
    artifactSubtype: parsed.value.artifactSubtype,
    artifactType: parsed.value.artifactType,
    taskType: parsed.value.taskType,
    payload: parsed.value.payload,
    lineage: parsed.value.lineage,
    validationStatus: "valid",
    validationErrors: [],
    reviewStatus: "unreviewed",
    isCurrent: true,
    supersedesArtifactId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function parseDeclaredBusinessArtifact(raw: string, task: Task):
  | { success: true; value: DeclaredBusinessArtifact }
  | { success: false; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { success: false, errors: [`Invalid JSON: ${(error as Error).message}`] };
  }

  if (!isRecord(json)) {
    return { success: false, errors: ["root: Expected an object."] };
  }

  const errors: string[] = [];
  const artifactKind = json.artifactKind ?? json.artifact_kind;
  const artifactRole = json.artifactRole ?? json.artifact_role;
  const artifactSubtype = json.artifactSubtype ?? json.artifact_subtype;
  const artifactType = json.artifactType ?? json.artifact_type;
  const taskType = json.taskType ?? json.task_type;
  const sourceProofId = json.sourceProofId ?? json.source_proof_id;

  let classification:
    | {
        artifactKind: BusinessArtifactKind;
        artifactRole: BusinessArtifactRole;
        artifactSubtype: string;
        artifactType: BusinessArtifactType;
      }
    | null = null;

  if (artifactKind !== undefined || artifactRole !== undefined || artifactSubtype !== undefined) {
    if (typeof artifactKind !== "string" || !BUSINESS_ARTIFACT_KINDS.has(artifactKind as BusinessArtifactKind)) {
      errors.push("artifactKind/artifact_kind: Expected a supported business artifact kind.");
    }
    if (typeof artifactRole !== "string" || !BUSINESS_ARTIFACT_ROLES.has(artifactRole as BusinessArtifactRole)) {
      errors.push("artifactRole/artifact_role: Expected a supported business artifact role.");
    }
    if (typeof artifactSubtype !== "string" || artifactSubtype.trim().length === 0) {
      errors.push("artifactSubtype/artifact_subtype: Expected a non-empty string.");
    }

    if (errors.length === 0) {
      classification = {
        artifactKind: artifactKind as BusinessArtifactKind,
        artifactRole: artifactRole as BusinessArtifactRole,
        artifactSubtype: (artifactSubtype as string).trim(),
        artifactType: legacyArtifactTypeFor(artifactKind as BusinessArtifactKind, artifactRole as BusinessArtifactRole),
      };
    }
  } else if (typeof artifactType === "string" && artifactType.trim().length > 0) {
    classification = classifyLegacyArtifactType(artifactType.trim(), task);
    if (!classification) {
      errors.push("artifactType: Unknown legacy artifact type and artifact role could not be inferred.");
    }
  } else {
    errors.push("artifactKind/artifact_kind: Required.");
    errors.push("artifactRole/artifact_role: Required.");
    errors.push("artifactSubtype/artifact_subtype: Required.");
  }

  if (typeof taskType !== "string" || taskType.trim().length === 0) {
    errors.push("taskType: Expected a non-empty string.");
  }
  if (!("payload" in json)) {
    errors.push("payload: Required.");
  }
  if (!("lineage" in json)) {
    errors.push("lineage: Required.");
  }
  if (sourceProofId !== undefined && typeof sourceProofId !== "string") {
    errors.push("sourceProofId/source_proof_id: Expected a string.");
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const parsedTaskType = typeof taskType === "string" ? taskType.trim() : "";

  return {
    success: true,
    value: {
      artifactKind: classification!.artifactKind,
      artifactRole: classification!.artifactRole,
      artifactSubtype: classification!.artifactSubtype,
      artifactType: classification!.artifactType,
      taskType: parsedTaskType,
      sourceProofId: typeof sourceProofId === "string" && sourceProofId.trim() ? sourceProofId.trim() : undefined,
      payload: json.payload,
      lineage: json.lineage,
    },
  };
}

function classifyLegacyArtifactType(
  artifactType: string,
  task: Task,
): {
  artifactKind: BusinessArtifactKind;
  artifactRole: BusinessArtifactRole;
  artifactSubtype: string;
  artifactType: BusinessArtifactType;
} | null {
  if (BUSINESS_ARTIFACT_TYPES.has(artifactType as BusinessArtifactType)) {
    return legacyClassificationFor(artifactType as BusinessArtifactType);
  }

  const inferredRole = inferArtifactRole(task);
  if (!inferredRole) {
    return null;
  }

  return {
    artifactKind: "deliverable",
    artifactRole: inferredRole,
    artifactSubtype: artifactType,
    artifactType: legacyArtifactTypeFor("deliverable", inferredRole),
  };
}

function legacyClassificationFor(artifactType: BusinessArtifactType): {
  artifactKind: BusinessArtifactKind;
  artifactRole: BusinessArtifactRole;
  artifactSubtype: string;
  artifactType: BusinessArtifactType;
} {
  switch (artifactType) {
    case "research_findings":
      return { artifactKind: "deliverable", artifactRole: "findings", artifactSubtype: "research_findings", artifactType };
    case "product_mvp_brief":
      return { artifactKind: "deliverable", artifactRole: "spec", artifactSubtype: "mvp_brief", artifactType };
    case "implementation_summary":
      return { artifactKind: "deliverable", artifactRole: "implementation", artifactSubtype: "implementation_summary", artifactType };
    case "validation_result":
      return { artifactKind: "deliverable", artifactRole: "validation", artifactSubtype: "validation_result", artifactType };
    case "preview_result":
      return { artifactKind: "deliverable", artifactRole: "validation", artifactSubtype: "preview_result", artifactType };
    case "launch_plan":
      return { artifactKind: "deliverable", artifactRole: "launch", artifactSubtype: "launch_plan", artifactType };
    case "deployment_result":
      return { artifactKind: "deliverable", artifactRole: "launch", artifactSubtype: "deployment_result", artifactType };
    case "final_founder_report":
      return { artifactKind: "final_report", artifactRole: "report", artifactSubtype: "final_founder_report", artifactType };
    case "direction_change_request":
      return {
        artifactKind: "direction_change_request",
        artifactRole: "none",
        artifactSubtype: "direction_change_request",
        artifactType,
      };
    case "blocker_report":
      return { artifactKind: "blocker", artifactRole: "none", artifactSubtype: "blocker_report", artifactType };
  }
}

function inferArtifactRole(task: Task): BusinessArtifactRole | null {
  const haystack = `${task.proofSchemaId} ${task.title} ${task.description}`.toLowerCase();
  if (haystack.includes("research") || haystack.includes("keyword")) {
    return "findings";
  }
  if (haystack.includes("brief") || haystack.includes("spec") || haystack.includes("mvp")) {
    return "spec";
  }
  if (haystack.includes("implement") || haystack.includes("prototype") || haystack.includes("diff")) {
    return "implementation";
  }
  if (haystack.includes("test") || haystack.includes("validat") || haystack.includes("preview")) {
    return "validation";
  }
  if (haystack.includes("launch") || haystack.includes("deploy") || haystack.includes("seo")) {
    return "launch";
  }
  if (haystack.includes("plan")) {
    return "plan";
  }
  if (haystack.includes("report")) {
    return "report";
  }
  return null;
}

function legacyArtifactTypeFor(
  artifactKind: BusinessArtifactKind,
  artifactRole: BusinessArtifactRole,
): BusinessArtifactType {
  if (artifactKind === "blocker") {
    return "blocker_report";
  }
  if (artifactKind === "direction_change_request") {
    return "direction_change_request";
  }
  if (artifactKind === "final_report") {
    return "final_founder_report";
  }

  switch (artifactRole) {
    case "findings":
      return "research_findings";
    case "spec":
      return "product_mvp_brief";
    case "implementation":
      return "implementation_summary";
    case "validation":
      return "validation_result";
    case "launch":
      return "launch_plan";
    case "plan":
      return "launch_plan";
    case "report":
      return "final_founder_report";
    case "none":
      return artifactKind === "decision_request" ? "direction_change_request" : "implementation_summary";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferTaskType(task: Task): string {
  return task.proofSchemaId || "general_task";
}
