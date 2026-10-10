import {
  isVerificationSatisfied,
  localizedTextSchema,
  parseExecutionReportInput,
  type ArtifactVerification,
  type BusinessArtifact,
  type BusinessArtifactKind,
  type BusinessArtifactRole,
  type BusinessArtifactType,
  type Locale,
  type Proof,
  type Task,
} from "@auto-crop/core";
import type { AgentCapabilityGrant, RuntimeCapability } from "../policies/capabilityGrant";
import { parseActionIntents } from "./actionIntent";
import type { ArtifactEnvelope } from "./artifactEnvelope";
import { parseOpenDecisions } from "./founderDecision";
import {
  evaluateVerificationReport,
  parseVerificationRequirements,
  type CaptureVerificationContext,
} from "./verificationContract";

type DeclaredBusinessArtifact = {
  artifactKind: BusinessArtifactKind;
  artifactRole: BusinessArtifactRole;
  artifactSubtype: string;
  artifactType: BusinessArtifactType;
  taskType: string;
  payload: unknown;
  lineage: unknown;
};

/**
 * Reachability evidence the agent recorded while the runtime controlled its Agent Run: the HTTP
 * status the agent's own fetch of the URL returned. Used to confirm an Environment-Blocked Blocker's
 * claim when the agent-owned Local Prototype Server is no longer listening by the time the claim is
 * checked. See ADR 0016.
 */
export type ReachabilitySnapshot = {
  httpStatus: number;
};

export type EnvironmentBlockerClaim = {
  capability: string;
  /** URL the runtime should independently fetch to check the claim, if one could be resolved. */
  url: string | null;
  /** Same-run reachability evidence to fall back on when the live fetch cannot reach the URL. */
  reachabilitySnapshot: ReachabilitySnapshot | null;
};

export type EnvironmentBlockerVerification = {
  capability: string;
  verified: boolean;
  checkedUrl: string | null;
  status?: number;
  /** Which evidence path confirmed the claim. Absent when the claim was not confirmed. */
  verifiedVia?: "runtime_url_check" | "capture_time_snapshot";
  reason?: "unsupported_capability" | "no_verifiable_url" | "fetch_failed" | "non_2xx" | "refuted_by_grant";
};

export type CaptureBusinessArtifactInput = {
  /** New execution runs must report actual work and its supporting evidence. */
  requireExecutionDetails?: boolean;
  task: Task;
  proofs: Proof[];
  /**
   * The run's Artifact Envelope (ADR 0041), or null when it submitted none. The envelope is the only
   * delivery: there is no workspace file to fall back to.
   */
  envelope: ArtifactEnvelope | null;
  /** Errors of the run's last rejected submission, when it made no valid one: an invalid delivery, not a missing one. */
  rejectedSubmission?: string[] | null;
  workspacePath: string;
  /**
   * The company's canonical content locale. A bare-string Execution Report field is normalized under
   * this key; defaults to `"en"` for older callers and companies created before `Company.locale`.
   */
  locale?: Locale;
  /** Result of independently checking an Environment-Blocked Blocker's claim. A verified claim degrades the blocker to a deliverable. */
  environmentBlockerVerification?: EnvironmentBlockerVerification;
  /**
   * The Verification Contract obligations of this task: declaring requirements for a consumer, or
   * verifying upstream output. Omitted by callers that capture outside that contract.
   */
  verificationContext?: CaptureVerificationContext;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

const VERIFIABLE_ENVIRONMENT_BLOCKER_CAPABILITIES = new Set(["browser_screenshot"]);

/**
 * Settle a run's Artifact Envelope into a Business Artifact. A missing envelope, or one that breaks
 * the delivery contract, is captured as a not-reviewable blocker so the task parks on it with a Hold
 * instead of passing as a delivery.
 */
export function captureBusinessArtifact(input: CaptureBusinessArtifactInput): BusinessArtifact {
  const timestamp = (input.now ?? (() => new Date()))().toISOString();
  const id = input.createId?.("business_artifact") ?? `business_artifact_${crypto.randomUUID()}`;
  const invalidDelivery = (reason: "missing_artifact_envelope" | "invalid_business_artifact_schema", errors: string[]): BusinessArtifact => ({
    id,
    companyId: input.task.companyId,
    taskId: input.task.id,
    sourceProofId: input.proofs[0]?.id ?? null,
    artifactKind: "blocker",
    artifactRole: "none",
    artifactSubtype: reason,
    artifactType: "blocker_report",
    taskType: inferTaskType(input.task),
    payload: { reason },
    lineage: {},
    validationStatus: "invalid_schema",
    validationErrors: errors,
    reviewStatus: "not_reviewable",
    isCurrent: true,
    supersedesArtifactId: null,
    deliveryWorkspacePath: input.workspacePath,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  if (!input.envelope) {
    return input.rejectedSubmission?.length
      ? invalidDelivery("invalid_business_artifact_schema", input.rejectedSubmission)
      : invalidDelivery("missing_artifact_envelope", ["No Artifact Envelope was submitted through submit_artifact_envelope."]);
  }
  const contractErrors = artifactEnvelopeContractErrors(input.envelope, {
    locale: input.locale ?? "en",
    requireDetails: input.requireExecutionDetails ?? false,
  });
  if (contractErrors.length > 0) {
    return invalidDelivery("invalid_business_artifact_schema", contractErrors);
  }

  const normalized = normalizeParsedArtifactForCapturedProof(
    {
      artifactKind: input.envelope.artifactKind,
      artifactRole: input.envelope.artifactRole,
      artifactSubtype: input.envelope.artifactSubtype,
      artifactType: legacyArtifactTypeFor(input.envelope.artifactKind, input.envelope.artifactRole),
      taskType: input.envelope.taskType,
      payload: input.envelope.payload,
      lineage: input.envelope.lineage,
    },
    input.environmentBlockerVerification,
  );
  const contract = evaluateVerificationObligations(normalized, input.verificationContext);
  return {
    id,
    companyId: input.task.companyId,
    taskId: input.task.id,
    sourceProofId: input.proofs[0]?.id ?? null,
    artifactKind: normalized.artifactKind,
    artifactRole: normalized.artifactRole,
    artifactSubtype: normalized.artifactSubtype,
    artifactType: normalized.artifactType,
    taskType: normalized.taskType,
    payload: normalized.payload,
    lineage: normalized.lineage,
    validationStatus: contract.errors.length > 0 ? "invalid_schema" : "valid",
    validationErrors: contract.errors,
    reviewStatus: contract.errors.length > 0 ? "not_reviewable" : "unreviewed",
    isCurrent: true,
    supersedesArtifactId: null,
    deliveryWorkspacePath: input.workspacePath,
    ...(contract.errors.length === 0 && contract.verification ? { verification: contract.verification } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * The delivery contract an envelope's payload must meet beyond its shape: a `deliverable` or
 * `final_report` carries an Outcome Summary, an Execution Report and well-formed Founder Decisions.
 *
 * One function for both moments it is checked — when the agent submits, so it can correct the
 * envelope in the same run, and at settlement, which is the authority. Two copies of these rules is
 * how the action path once settled deliveries the file path would have rejected.
 */
export function artifactEnvelopeContractErrors(
  envelope: Pick<ArtifactEnvelope, "artifactKind" | "payload">,
  options: { locale: Locale; requireDetails: boolean },
): string[] {
  if (envelope.artifactKind !== "deliverable" && envelope.artifactKind !== "final_report") {
    return [];
  }
  const errors: string[] = [];
  const outcomeSummaryError = outcomeSummaryFieldError(envelope.payload);
  if (outcomeSummaryError) {
    errors.push(outcomeSummaryError);
  }
  const executionReportError = executionReportFieldError(envelope.payload, { required: true, ...options });
  if (executionReportError) {
    errors.push(executionReportError);
  }
  // An `open_decisions` entry on an unknown decisionKind is dropped silently; a malformed entry on a
  // known decisionKind is a structural failure like any other required-field failure.
  errors.push(...parseOpenDecisions(envelope.payload, options.locale).errors);
  return errors;
}

/**
 * Apply the delivery contracts to a captured artifact: its Action Intent declaration, and — when the task
 * has verification duty — the Verification Contract. The verification obligation follows the task's
 * declared duty, not the artifact kind its agent chose: a verifier filing a `final_report` instead of a
 * `deliverable` is still judged, or it could skip the contract by relabelling a failed report. Only a
 * blocker is exempt from both — it says the work could not be done and is never reviewable.
 */
function evaluateVerificationObligations(
  artifact: DeclaredBusinessArtifact,
  context: CaptureVerificationContext | undefined,
): { errors: string[]; verification: ArtifactVerification | null } {
  if (artifact.artifactKind === "blocker") {
    return { errors: [], verification: null };
  }

  // A declaration the runtime cannot read is a contract violation, like a malformed Execution Report:
  // acceptance must never fall back to guessing from prose because the structure was wrong. Checked for
  // every delivery, with or without verification duty.
  const errors = parseActionIntents(artifact.payload).errors;
  if (!context) {
    return { errors, verification: null };
  }
  errors.push(...(context.producesRequirements ? parseVerificationRequirements(artifact.payload).errors : []));
  if (!context.verifier) {
    return { errors, verification: null };
  }

  const report = evaluateVerificationReport({ payload: artifact.payload, context: context.verifier });
  return { errors: [...errors, ...report.errors], verification: report.verification };
}

/**
 * A `deliverable` / `final_report` must carry a structured Execution Report — `conclusion`,
 * `vision_impact`, `remaining_gap`, `recommendation` — each a non-empty string (authored in the
 * company locale, `options.locale`) or an `{ en, zh }` object. A completely absent `execution_report`
 * is a structural validation failure as before. A field that is present but omits the company locale
 * (has another locale instead) is NOT a failure: it parses, and the dashboard shows a visible
 * "untranslated" marker rather than blocking completion or acceptance (spec Decision 2).
 */
function executionReportFieldError(payload: unknown, options: { required: boolean; locale: Locale; requireDetails?: boolean }): string | null {
  const required =
    "payload.execution_report: Required for deliverable and final_report artifacts (conclusion, vision_impact, remaining_gap, recommendation).";
  if (!isRecord(payload)) {
    return options.required ? required : null;
  }
  const value = payload.execution_report ?? payload.executionReport;
  if (options.requireDetails || payload.report_version === 2) {
    const report = parseExecutionReportInput(value, options.locale);
    if (!report?.workSummary || !report.evidence) return "payload.execution_report: New execution reports require work_summary and evidence.";
  }
  if (value === undefined || value === null) {
    return options.required ? required : null;
  }
  return parseExecutionReportInput(value, options.locale)
    ? null
    : "payload.execution_report: Expected conclusion, vision_impact, remaining_gap, and recommendation as non-empty strings or localized text objects.";
}

/**
 * A `deliverable` / `final_report` must carry the completing agent's Task Outcome Summary in
 * `payload.outcome_summary` (or `outcomeSummary`) — a non-empty string or a `{ en, zh }` localized
 * object. A missing or malformed field is a structural validation failure like any other missing
 * required field; the runtime does not judge the summary's meaning. Returns the error string, or null
 * when the field is present and well-shaped.
 */
function outcomeSummaryFieldError(payload: unknown): string | null {
  const required = "payload.outcome_summary: Required for deliverable and final_report artifacts (non-empty string or { en, zh }).";
  if (!isRecord(payload)) {
    return required;
  }
  const value = payload.outcome_summary ?? payload.outcomeSummary;
  if (value === undefined || value === null) {
    return required;
  }
  if (typeof value === "string") {
    return value.trim().length > 0 ? null : required;
  }
  if (isRecord(value)) {
    return localizedTextSchema.safeParse(value).success ? null : required;
  }
  return required;
}

function normalizeParsedArtifactForCapturedProof(
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
        // A verified result always names its path; default to the live check for the ADR 0015 shape.
        verifiedVia: environmentBlockerVerification.verifiedVia ?? "runtime_url_check",
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
 * True when a Business Artifact is a current, valid, still-unreviewed deliverable — the shape that
 * can go to CEO Office (manual review or Automatic Acceptance). Blockers, superseded or invalid
 * artifacts, and already-reviewed ones are not reviewable.
 */
export function isReviewableBusinessArtifact(artifact: BusinessArtifact): boolean {
  return (
    artifact.isCurrent &&
    artifact.validationStatus === "valid" &&
    artifact.reviewStatus === "unreviewed" &&
    // A well-formed verification report whose verdict is not `passed` is diagnostic evidence, not a
    // delivery anyone may accept.
    isVerificationSatisfied(artifact) &&
    (artifact.artifactKind === "deliverable" || artifact.artifactKind === "final_report")
  );
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
 * Read an Environment-Blocked Blocker's checkable claim from the run's Artifact Envelope.
 * The URL to check is resolved as `payload.target_url` -> `payload.server_validation.url` ->
 * the first `url` (local-url) proof.
 */
export function readEnvironmentBlockerClaim(envelope: ArtifactEnvelope | null, proofs: Proof[]): EnvironmentBlockerClaim | null {
  const payload = envelope?.payload;
  if (envelope?.artifactKind !== "blocker" || !isRecord(payload)) {
    return null;
  }
  const capability = resolveEnvironmentBlockerCapability({
    artifactKind: "blocker",
    artifactSubtype: envelope.artifactSubtype,
    taskType: envelope.taskType,
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

  return { capability, url, reachabilitySnapshot: readReachabilitySnapshot(serverValidation) };
}

/**
 * Read the agent's same-run reachability evidence from `payload.server_validation.http_status` (the
 * one key the agent is told to record). A missing or out-of-range value yields no snapshot; a
 * non-numeric sibling such as `status: "running"` is not consulted.
 */
function readReachabilitySnapshot(serverValidation: Record<string, unknown> | null): ReachabilitySnapshot | null {
  if (!serverValidation) {
    return null;
  }
  const httpStatus = serverValidation.http_status;
  if (typeof httpStatus !== "number" || !Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) {
    return null;
  }
  return { httpStatus };
}

function isOkStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Names an agent is likely to use for a capability the runtime can actually grant. Claims arrive as
 * free text, so the runtime has to recognize the capability before it can say whether it granted it.
 *
 * Deliberately narrow: a name outside this table is a capability the runtime does not grant
 * (`browser_screenshot`, `keyword_data`), and those claims must still be believed. Widening it by
 * guessing would start refuting honest blockers, which is the more expensive mistake.
 */
const GRANTABLE_CAPABILITY_ALIASES: Record<string, RuntimeCapability> = {
  web_research: "web_research",
  web_search: "web_research",
  websearch: "web_research",
  web_access: "web_research",
  network: "web_research",
  network_access: "web_research",
  internet: "web_research",
  internet_access: "web_research",
  live_web: "web_research",
  run_command: "run_command",
  shell: "run_command",
  bash: "run_command",
  command_execution: "run_command",
};

/**
 * True when the agent claims a capability was unavailable that this run was in fact granted.
 *
 * Without a grant to check against (an older caller, or a path that launches no agent), nothing is
 * refuted — absence of evidence must not become evidence.
 */
function isRefutedByGrant(capability: string, grant: AgentCapabilityGrant | undefined): boolean {
  if (!grant) {
    return false;
  }

  const normalized = capability.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const resolved = GRANTABLE_CAPABILITY_ALIASES[normalized];
  return resolved !== undefined && grant.granted.includes(resolved);
}

/**
 * Confirm an Environment-Blocked Blocker's claim, in order of evidence strength (ADR 0016). For
 * `browser_screenshot`:
 *
 * 1. Live check — fetch the declared URL; a 2xx response confirms via `runtime_url_check`.
 * 2. Reachability Snapshot — when the URL cannot be reached at all (the Local Prototype Server has
 *    exited, or there is no URL), confirm against the agent's same-run `server_validation`
 *    `http_status` 2xx via `capture_time_snapshot`.
 *
 * A live non-2xx response is an affirmative "the route is broken now" signal and keeps the blocker in
 * place — the snapshot only backstops the absence of a live signal, not a contradicting one. The
 * snapshot is trusted only because this runs inside a runtime-controlled Agent Run (the scheduler
 * calls it after `agentResult.status === "complete"`).
 */
export async function verifyEnvironmentBlockerClaim(input: {
  claim: EnvironmentBlockerClaim;
  fetchImpl?: typeof fetch;
  /** What the runtime actually handed this run. A claim contradicting it is refuted (ADR 0021). */
  grant?: AgentCapabilityGrant;
}): Promise<EnvironmentBlockerVerification> {
  const { capability, url, reachabilitySnapshot } = input.claim;

  // The mirror of the confirmation paths below. There, runtime-held evidence confirms a claim the
  // agent could not prove; here it refutes one the agent should not have filed. The runtime is the
  // authority on what it granted, so "the environment did not allow X" is checkable, not testimony.
  if (isRefutedByGrant(capability, input.grant)) {
    return { capability, verified: false, checkedUrl: url, reason: "refuted_by_grant" };
  }

  if (!VERIFIABLE_ENVIRONMENT_BLOCKER_CAPABILITIES.has(capability)) {
    return { capability, verified: false, checkedUrl: url, reason: "unsupported_capability" };
  }

  if (url) {
    const fetchImpl = input.fetchImpl ?? fetch;
    try {
      const response = await fetchImpl(url, { method: "GET" });
      if (response.ok) {
        return { capability, verified: true, checkedUrl: url, status: response.status, verifiedVia: "runtime_url_check" };
      }
      // Server answered and the route is not serving: don't let a stale snapshot override it.
      return { capability, verified: false, checkedUrl: url, status: response.status, reason: "non_2xx" };
    } catch {
      // Nothing listening — fall through to the same-run snapshot.
    }
  }

  if (reachabilitySnapshot && isOkStatus(reachabilitySnapshot.httpStatus)) {
    return {
      capability,
      verified: true,
      checkedUrl: url,
      status: reachabilitySnapshot.httpStatus,
      verifiedVia: "capture_time_snapshot",
    };
  }

  return {
    capability,
    verified: false,
    checkedUrl: url,
    reason: url ? "fetch_failed" : "no_verifiable_url",
  };
}

function firstUrlString(value: unknown): string | null {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
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
