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

export type EnvironmentBlockerClaim = {
  capability: string;
  /** URL the runtime should independently fetch to check the claim, if one could be resolved. */
  url: string | null;
};

export type EnvironmentBlockerVerification = {
  capability: string;
  verified: boolean;
  checkedUrl: string | null;
  status?: number;
  reason?: "unsupported_capability" | "no_verifiable_url" | "fetch_failed" | "non_2xx";
};

export type CaptureBusinessArtifactInput = {
  task: Task;
  proofs: Proof[];
  workspacePath: string;
  /** Result of independently checking an Environment-Blocked Blocker's claim. A verified claim degrades the blocker to a deliverable. */
  environmentBlockerVerification?: EnvironmentBlockerVerification;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

const VERIFIABLE_ENVIRONMENT_BLOCKER_CAPABILITIES = new Set(["browser_screenshot"]);

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
  const artifactValue = normalizeParsedArtifactForCapturedProof(
    input.task,
    input.proofs,
    parsed.value,
    input.environmentBlockerVerification,
  );

  return {
    id,
    companyId: input.task.companyId,
    taskId: input.task.id,
    sourceProofId: artifactValue.sourceProofId ?? input.proofs[0]?.id ?? null,
    artifactKind: artifactValue.artifactKind,
    artifactRole: artifactValue.artifactRole,
    artifactSubtype: artifactValue.artifactSubtype,
    artifactType: artifactValue.artifactType,
    taskType: artifactValue.taskType,
    payload: artifactValue.payload,
    lineage: artifactValue.lineage,
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

function normalizeParsedArtifactForCapturedProof(
  task: Task,
  proofs: Proof[],
  artifact: DeclaredBusinessArtifact,
  environmentBlockerVerification: EnvironmentBlockerVerification | undefined,
): DeclaredBusinessArtifact {
  if (!isVerifiableEnvironmentBlocker(artifact) || !environmentBlockerVerification?.verified) {
    // Unverified render evidence is never accepted on the agent's word: the blocker stands.
    return artifact;
  }

  return {
    ...artifact,
    artifactKind: "deliverable",
    artifactRole: artifact.artifactRole === "none" ? "validation" : artifact.artifactRole,
    artifactSubtype: artifact.artifactSubtype,
    artifactType: "validation_result",
    payload: {
      ...(isRecord(artifact.payload) ? artifact.payload : { originalPayload: artifact.payload }),
      validationLimits: {
        capability: environmentBlockerVerification.capability,
        status: "degraded_from_environment_blocked",
        verifiedVia: "runtime_url_check",
        checkedUrl: environmentBlockerVerification.checkedUrl,
        httpStatus: environmentBlockerVerification.status ?? null,
      },
    },
  };
}

const SCREENSHOT_BLOCKER_PATTERN = /screenshot|screen[_ -]?capture|render[_ -]?evidence/i;

type EnvironmentBlockerShape = {
  artifactKind: unknown;
  artifactSubtype?: unknown;
  taskType?: unknown;
  payload: unknown;
};

/**
 * The capability an Environment-Blocked Blocker's claim can be checked against, or null when the
 * artifact is not a verifiable environment blocker.
 *
 * The explicit contract is `blocker_class: "environment_blocked"` plus a `capability` string. As a
 * fallback the runtime also recognizes the shape a render-evidence agent naturally leaves when the
 * sandbox blocks every capture path: a `blocker` whose subtype, task type, or `payload.proof.schema`
 * names a screenshot but which omits the gate keys. Recognition is deliberately generous because
 * verification stays strict — an unverifiable claim keeps the blocker in place.
 */
function resolveEnvironmentBlockerCapability(artifact: EnvironmentBlockerShape): string | null {
  if (artifact.artifactKind !== "blocker" || !isRecord(artifact.payload)) {
    return null;
  }
  const payload = artifact.payload;
  const declaredCapability =
    typeof payload.capability === "string" && payload.capability.length > 0 ? payload.capability : null;
  const blockerClass = payload.blocker_class ?? payload.blockerClass;

  if (blockerClass === "environment_blocked" && declaredCapability) {
    return declaredCapability;
  }

  const proof = isRecord(payload.proof) ? payload.proof : null;
  const namesScreenshot = [artifact.artifactSubtype, artifact.taskType, proof?.schema].some(
    (value) => typeof value === "string" && SCREENSHOT_BLOCKER_PATTERN.test(value),
  );
  if (namesScreenshot) {
    return declaredCapability ?? "browser_screenshot";
  }
  return null;
}

/**
 * True when a blocker artifact carries an Environment-Blocked claim the runtime may independently
 * check — either the explicit `blocker_class`/`capability` contract or the natural screenshot-capture
 * blocker shape. See {@link resolveEnvironmentBlockerCapability}.
 */
export function isVerifiableEnvironmentBlocker(
  artifact: Pick<DeclaredBusinessArtifact, "artifactKind" | "payload"> &
    Partial<Pick<DeclaredBusinessArtifact, "artifactSubtype" | "taskType">>,
): boolean {
  return resolveEnvironmentBlockerCapability(artifact) !== null;
}

/**
 * Read an Environment-Blocked Blocker's checkable claim from `.auto-crop/business-artifact.json`.
 * The URL to check is resolved as `payload.target_url` -> `payload.server_validation.url` ->
 * the first `url` (local-url) proof.
 */
export function readEnvironmentBlockerClaim(workspacePath: string, proofs: Proof[]): EnvironmentBlockerClaim | null {
  const sourcePath = join(workspacePath, BUSINESS_ARTIFACT_PATH);
  if (!existsSync(sourcePath)) {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(sourcePath, "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(json)) {
    return null;
  }

  const artifactKind = json.artifactKind ?? json.artifact_kind;
  const payload = json.payload;
  if (artifactKind !== "blocker" || !isRecord(payload)) {
    return null;
  }
  const capability = resolveEnvironmentBlockerCapability({
    artifactKind: "blocker",
    artifactSubtype: json.artifactSubtype ?? json.artifact_subtype,
    taskType: json.taskType ?? json.task_type,
    payload,
  });
  if (!capability) {
    return null;
  }

  const serverValidation = isRecord(payload.server_validation) ? payload.server_validation : null;
  const url =
    firstUrlString(payload.target_url) ??
    firstUrlString(serverValidation?.url) ??
    proofs.find((proof) => proof.type === "url")?.uri ??
    null;

  return { capability, url };
}

/**
 * Independently check an Environment-Blocked Blocker's claim. For `browser_screenshot` the runtime
 * fetches the declared URL and expects a 2xx response; anything else keeps the blocker in place.
 */
export async function verifyEnvironmentBlockerClaim(input: {
  claim: EnvironmentBlockerClaim;
  fetchImpl?: typeof fetch;
}): Promise<EnvironmentBlockerVerification> {
  const { capability, url } = input.claim;

  if (!VERIFIABLE_ENVIRONMENT_BLOCKER_CAPABILITIES.has(capability)) {
    return { capability, verified: false, checkedUrl: url, reason: "unsupported_capability" };
  }
  if (!url) {
    return { capability, verified: false, checkedUrl: null, reason: "no_verifiable_url" };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, { method: "GET" });
    return {
      capability,
      verified: response.ok,
      checkedUrl: url,
      status: response.status,
      reason: response.ok ? undefined : "non_2xx",
    };
  } catch {
    return { capability, verified: false, checkedUrl: url, reason: "fetch_failed" };
  }
}

function firstUrlString(value: unknown): string | null {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
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
