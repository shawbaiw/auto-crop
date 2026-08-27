import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BusinessArtifact, BusinessArtifactType, Proof, Task } from "@auto-crop/core";

const BUSINESS_ARTIFACT_PATH = join(".auto-crop", "business-artifact.json");
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
  const parsed = parseDeclaredBusinessArtifact(raw);
  if (!parsed.success) {
    return {
      id,
      companyId: input.task.companyId,
      taskId: input.task.id,
      sourceProofId: input.proofs[0]?.id ?? null,
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

function parseDeclaredBusinessArtifact(raw: string):
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
  const artifactType = json.artifactType ?? json.artifact_type;
  const taskType = json.taskType ?? json.task_type;
  const sourceProofId = json.sourceProofId ?? json.source_proof_id;

  if (typeof artifactType !== "string" || !BUSINESS_ARTIFACT_TYPES.has(artifactType as BusinessArtifactType)) {
    errors.push("artifactType: Expected a supported business artifact type.");
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
      artifactType: artifactType as BusinessArtifactType,
      taskType: parsedTaskType,
      sourceProofId: typeof sourceProofId === "string" && sourceProofId.trim() ? sourceProofId.trim() : undefined,
      payload: json.payload,
      lineage: json.lineage,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferTaskType(task: Task): string {
  return task.proofSchemaId || "general_task";
}
