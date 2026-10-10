import type { BusinessArtifactKind, BusinessArtifactRole, ProofType } from "@auto-crop/core";

export type ProofReference = {
  type: ProofType;
  uri: string;
  summary?: string;
};

export type FileReference = {
  path: string;
  description?: string;
};

export type ArtifactEnvelope = {
  artifactKind: BusinessArtifactKind;
  artifactRole: BusinessArtifactRole;
  artifactSubtype: string;
  taskType: string;
  payload: unknown;
  lineage: unknown;
  proofRefs?: ProofReference[];
  fileRefs?: FileReference[];
};

export type ArtifactEnvelopeParseResult =
  | { success: true; value: ArtifactEnvelope; ignoredIdentityFields: string[] }
  | { success: false; errors: string[]; ignoredIdentityFields: string[] };

const ARTIFACT_KIND_VALUES: BusinessArtifactKind[] = [
  "deliverable",
  "blocker",
  "decision_request",
  "direction_change_request",
  "final_report",
];
const ARTIFACT_KINDS = new Set<BusinessArtifactKind>(ARTIFACT_KIND_VALUES);

const ARTIFACT_ROLE_VALUES: BusinessArtifactRole[] = [
  "findings",
  "plan",
  "spec",
  "implementation",
  "validation",
  "launch",
  "report",
  "none",
];
const ARTIFACT_ROLES = new Set<BusinessArtifactRole>(ARTIFACT_ROLE_VALUES);

const IDENTITY_FIELDS = ["taskId", "task_id", "companyId", "company_id", "runId", "run_id"] as const;
const PROOF_TYPE_VALUES: ProofType[] = ["file", "diff", "url", "screenshot", "command_output", "test_result", "deployment"];
const PROOF_TYPES = new Set<ProofType>(PROOF_TYPE_VALUES);

/**
 * The envelope's shape as a JSON Schema, for the `submit_artifact_envelope` tool's `inputSchema`.
 *
 * Declared beside the parser so the two cannot drift. It is not a convenience: given a schema with no
 * properties, Claude Code sent `payload` as a JSON string, which the parser rightly rejected, so the
 * delivery never landed. Naming each field's type is what makes the client send structure.
 */
export const ARTIFACT_ENVELOPE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    artifact_kind: { type: "string", enum: ARTIFACT_KIND_VALUES },
    artifact_role: { type: "string", enum: ARTIFACT_ROLE_VALUES },
    artifact_subtype: { type: "string", minLength: 1 },
    task_type: { type: "string", minLength: 1 },
    payload: { type: "object", description: "The delivery itself, including execution_report and outcome_summary for a deliverable or final_report." },
    lineage: { type: "object" },
    proof_refs: {
      type: "array",
      items: {
        type: "object",
        properties: { type: { type: "string", enum: PROOF_TYPE_VALUES }, uri: { type: "string" }, summary: { type: "string" } },
        required: ["type", "uri"],
      },
    },
    file_refs: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, description: { type: "string" } },
        required: ["path"],
      },
    },
  },
  required: ["artifact_kind", "artifact_role", "artifact_subtype", "task_type", "payload", "lineage"],
} as const;

export function parseArtifactEnvelope(input: unknown): ArtifactEnvelopeParseResult {
  if (!isRecord(input)) {
    return { success: false, errors: ["root: Expected an object."], ignoredIdentityFields: [] };
  }

  const ignoredIdentityFields = IDENTITY_FIELDS.filter((field) => field in input);
  const errors: string[] = [];
  const artifactKind = input.artifactKind ?? input.artifact_kind;
  const artifactRole = input.artifactRole ?? input.artifact_role;
  const artifactSubtype = input.artifactSubtype ?? input.artifact_subtype;
  const taskType = input.taskType ?? input.task_type;
  const proofRefs = input.proofRefs ?? input.proof_refs;
  const fileRefs = input.fileRefs ?? input.file_refs;

  if (typeof artifactKind !== "string" || !ARTIFACT_KINDS.has(artifactKind as BusinessArtifactKind)) {
    errors.push("artifactKind/artifact_kind: Expected a supported business artifact kind.");
  }
  if (typeof artifactRole !== "string" || !ARTIFACT_ROLES.has(artifactRole as BusinessArtifactRole)) {
    errors.push("artifactRole/artifact_role: Expected a supported business artifact role.");
  }
  if (typeof artifactSubtype !== "string" || artifactSubtype.trim().length === 0) {
    errors.push("artifactSubtype/artifact_subtype: Expected a non-empty string.");
  }
  if (typeof taskType !== "string" || taskType.trim().length === 0) {
    errors.push("taskType/task_type: Expected a non-empty string.");
  }
  if (!("payload" in input)) {
    errors.push("payload: Required.");
  }
  if (!("lineage" in input)) {
    errors.push("lineage: Required.");
  }

  const parsedProofRefs = parseProofRefs(proofRefs);
  if (!parsedProofRefs.success) {
    errors.push(...parsedProofRefs.errors);
  }
  const parsedFileRefs = parseFileRefs(fileRefs);
  if (!parsedFileRefs.success) {
    errors.push(...parsedFileRefs.errors);
  }

  if (errors.length > 0) {
    return { success: false, errors, ignoredIdentityFields };
  }

  const value: ArtifactEnvelope = {
    artifactKind: artifactKind as BusinessArtifactKind,
    artifactRole: artifactRole as BusinessArtifactRole,
    artifactSubtype: (artifactSubtype as string).trim(),
    taskType: (taskType as string).trim(),
    payload: input.payload,
    lineage: input.lineage,
  };
  if (parsedProofRefs.value.length > 0) value.proofRefs = parsedProofRefs.value;
  if (parsedFileRefs.value.length > 0) value.fileRefs = parsedFileRefs.value;
  return { success: true, value, ignoredIdentityFields };
}

function parseProofRefs(value: unknown): { success: true; value: ProofReference[] } | { success: false; errors: string[]; value: [] } {
  if (value === undefined) {
    return { success: true, value: [] };
  }
  if (!Array.isArray(value)) {
    return { success: false, errors: ["proofRefs/proof_refs: Expected an array."], value: [] };
  }
  const errors: string[] = [];
  const refs: ProofReference[] = [];
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`proofRefs[${index}]: Expected an object.`);
      return;
    }
    const itemErrors: string[] = [];
    if (typeof item.type !== "string" || !PROOF_TYPES.has(item.type as ProofType)) {
      itemErrors.push(`proofRefs[${index}].type: Expected a supported proof type.`);
    }
    if (typeof item.uri !== "string" || item.uri.trim().length === 0) {
      itemErrors.push(`proofRefs[${index}].uri: Expected a non-empty string.`);
    }
    if (item.summary !== undefined && typeof item.summary !== "string") {
      itemErrors.push(`proofRefs[${index}].summary: Expected a string.`);
    }
    errors.push(...itemErrors);
    if (itemErrors.length === 0) {
      if (typeof item.type === "string" && PROOF_TYPES.has(item.type as ProofType) && typeof item.uri === "string" && item.uri.trim()) {
        refs.push({
          type: item.type as ProofType,
          uri: item.uri.trim(),
          ...(typeof item.summary === "string" ? { summary: item.summary } : {}),
        });
      }
    }
  });
  return errors.length > 0 ? { success: false, errors, value: [] } : { success: true, value: refs };
}

function parseFileRefs(value: unknown): { success: true; value: FileReference[] } | { success: false; errors: string[]; value: [] } {
  if (value === undefined) {
    return { success: true, value: [] };
  }
  if (!Array.isArray(value)) {
    return { success: false, errors: ["fileRefs/file_refs: Expected an array."], value: [] };
  }
  const errors: string[] = [];
  const refs: FileReference[] = [];
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`fileRefs[${index}]: Expected an object.`);
      return;
    }
    const itemErrors: string[] = [];
    const path = item.path ?? item.workspace_path;
    if (typeof path !== "string" || path.trim().length === 0) {
      itemErrors.push(`fileRefs[${index}].path: Expected a non-empty string.`);
    }
    if (item.description !== undefined && typeof item.description !== "string") {
      itemErrors.push(`fileRefs[${index}].description: Expected a string.`);
    }
    errors.push(...itemErrors);
    if (itemErrors.length === 0 && typeof path === "string" && path.trim()) {
      refs.push({
        path: path.trim(),
        ...(typeof item.description === "string" ? { description: item.description } : {}),
      });
    }
  });
  return errors.length > 0 ? { success: false, errors, value: [] } : { success: true, value: refs };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
