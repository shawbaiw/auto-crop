import type { BusinessArtifact, NextStepItem, Task, TaskCompletionEvent, TaskEvent, TaskProgressEvent } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { humanActionIdFor } from "./ceoAttention";
import { createDefaultId } from "./ids";
import { recordTaskCompletionEvent } from "./taskCompletion";
import { applyTaskTransition } from "./taskTransition";

type Repositories = ReturnType<typeof createRepositories>;

/**
 * The one thing a Blocker Report asks a person to bring back from outside the runtime so the same task
 * can continue (ADR 0042). `evidenceRequirements` are the fields a Human Action Confirmation must fill;
 * each becomes one evidence key, so a person supplying data in parts is the agent's requirements to
 * split, not a second founder click.
 */
export type UnblockRequest = {
  needed: string;
  why: string;
  evidenceRequirements: string[];
};

const MAX_EVIDENCE_REQUIREMENTS = 12;

/**
 * Read `payload.unblock_request` from a blocker's payload. Absent is not an error: most blockers ask
 * nobody for anything. Present and malformed is, and it is reported when the agent submits so it can
 * correct it inside the run (ADR 0041), through {@link artifactEnvelopeContractErrors}.
 */
export function parseUnblockRequest(payload: unknown): { request: UnblockRequest | null; errors: string[] } {
  if (!isRecord(payload) || payload.unblock_request === undefined || payload.unblock_request === null) {
    return { request: null, errors: [] };
  }
  const value = payload.unblock_request;
  const shape = "payload.unblock_request: Expected { \"needed\": string, \"why\": string, \"evidence_requirements\": [string, ...] }.";
  if (!isRecord(value)) {
    return { request: null, errors: [shape] };
  }

  const errors: string[] = [];
  const needed = nonEmptyString(value.needed);
  const why = nonEmptyString(value.why);
  if (!needed) errors.push("payload.unblock_request.needed: Expected a non-empty string naming what a person must bring back.");
  if (!why) errors.push("payload.unblock_request.why: Expected a non-empty string saying why this task cannot continue without it.");

  const rawRequirements = value.evidence_requirements;
  const requirements = Array.isArray(rawRequirements) ? rawRequirements.map(nonEmptyString) : [];
  if (!Array.isArray(rawRequirements) || requirements.length === 0 || requirements.some((requirement) => requirement === null)) {
    errors.push("payload.unblock_request.evidence_requirements: Expected a non-empty array of non-empty strings, one per value a person must supply.");
  } else if (new Set(requirements).size !== requirements.length) {
    errors.push("payload.unblock_request.evidence_requirements: Each requirement must be distinct; each one is a separate field the person fills in.");
  } else if (requirements.length > MAX_EVIDENCE_REQUIREMENTS) {
    errors.push(`payload.unblock_request.evidence_requirements: At most ${MAX_EVIDENCE_REQUIREMENTS} requirements; ask for the one thing this task needs.`);
  }

  // Secrets are out of scope: a capability a run lacks is an Agent Capability Grant, decided elsewhere,
  // never something a person types into a Human Action that is then written into a prompt.
  for (const [field, text] of [["needed", needed], ...requirements.map((requirement, index) => [`evidence_requirements[${index}]`, requirement] as const)] as const) {
    const term = text ? credentialTermIn(text) : null;
    if (term) {
      errors.push(`payload.unblock_request.${field}: Must not ask for credentials ("${term}"). Ask for the data a person can look up, never for a login, key or token.`);
    }
  }

  return errors.length > 0 || !needed || !why
    ? { request: null, errors }
    : { request: { needed, why, evidenceRequirements: requirements as string[] }, errors: [] };
}

/**
 * The Unblock Request of a settled artifact, when it has one the runtime will act on: a valid,
 * current Blocker Report whose request parses. Everything else is not a request for input.
 */
export function unblockRequestOf(artifact: Pick<BusinessArtifact, "artifactKind" | "validationStatus" | "payload"> | null | undefined): UnblockRequest | null {
  if (!artifact || artifact.artifactKind !== "blocker" || artifact.validationStatus !== "valid") {
    return null;
  }
  return parseUnblockRequest(artifact.payload).request;
}

/**
 * The Human Action an Unblock Request becomes, as a Next Step Item on the blocked task's completion
 * event — the same record every other Human Action is projected from, so CEO Office, confirmation and
 * Settled Facts read it without a second path. It sits on the blocked task itself and gates no other
 * task: the task graph does not change (ADR 0042).
 */
export function unblockRequestNextStepItem(artifact: BusinessArtifact, task: Task): NextStepItem | null {
  const request = unblockRequestOf(artifact);
  if (!request) {
    return null;
  }
  return {
    type: "human_action",
    label: request.needed,
    ownerDepartmentId: task.departmentId,
    relatedTaskId: task.id,
    relatedBusinessArtifactId: artifact.id,
    dependencyImpact: { unblockRequest: { why: request.why } },
    severity: "blocking",
    priority: null,
    evidenceRequirements: request.evidenceRequirements,
  };
}

/** True for the Next Step Item {@link unblockRequestNextStepItem} builds. */
export function isUnblockRequestItem(item: NextStepItem): boolean {
  return item.type === "human_action" && isRecord(item.dependencyImpact) && isRecord(item.dependencyImpact.unblockRequest);
}

/**
 * Park a task on the Human Action its Blocker Report's Unblock Request asks for. The one place a
 * settlement does this, called from inside the settlement transaction by every path that settles a
 * delivery — a run's own settlement and Proof recovery — so the two cannot disagree about what a
 * request for input does to its task (ADR 0035, ADR 0042).
 *
 * The task goes to `blocked` with an `awaiting_human_action` Hold naming the Human Action, never an
 * `invalid_business_artifact` Hold: the blocker is an honest delivery, and the way forward is the
 * person's answer (or a replan), not a re-run into the same wall.
 */
export function parkOnUnblockRequest(input: {
  repositories: Repositories;
  task: Task;
  artifact: BusinessArtifact;
  now?: () => Date;
  createId?: (prefix: string) => string;
}): { humanActionId: string; completionEvent: TaskCompletionEvent; taskEvent: TaskEvent; progressEvent: TaskProgressEvent } {
  const request = unblockRequestOf(input.artifact);
  if (!request) {
    throw new Error(`Business Artifact ${input.artifact.id} carries no Unblock Request.`);
  }
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? createDefaultId;
  const timestamp = now().toISOString();

  const completionEvent = recordTaskCompletionEvent({
    repositories: input.repositories,
    task: input.task,
    businessArtifact: input.artifact,
    outcome: "awaiting_human_action",
    now,
    createId,
  });
  const index = completionEvent.nextStepItems.findIndex(isUnblockRequestItem);
  if (index < 0) {
    throw new Error(`Completion event ${completionEvent.id} did not record the Unblock Request of ${input.artifact.id}.`);
  }
  const humanActionId = humanActionIdFor(completionEvent.id, index);

  const reason = `Human Action required: ${request.needed}`;
  applyTaskTransition({
    repositories: input.repositories,
    task: input.task,
    status: "blocked",
    executionSummary: { latestFailureReason: "awaiting_human_action", latestFailureMessage: reason, dependencyNote: null },
    hold: { kind: "awaiting_human_action", resolver: "founder", subjectKind: "human_action", subjectId: humanActionId, reason },
    // A delivery answers whatever said the task had none: Proof recovery can find this blocker on a task
    // already parked for a missing or unreadable delivery, and that Hold must not outlive the answer.
    resolvesHoldKinds: ["invalid_business_artifact", "runtime_interrupted"],
    now,
    createId,
  });

  const taskEvent: TaskEvent = {
    id: createId("task_event"),
    companyId: input.task.companyId,
    taskId: input.task.id,
    type: "task_blocked",
    message: `${input.task.title} asks a person for input: ${request.needed}.`,
    createdAt: timestamp,
    status: "blocked",
    failureReason: "awaiting_human_action",
    failureMessage: reason,
    executionProfileName: null,
    requestedTimeoutMs: null,
    effectiveTimeoutMs: null,
    dependencyNote: null,
    artifactWorkspacePath: input.task.artifactWorkspacePath ?? null,
  };
  input.repositories.appendTaskEvent(taskEvent);

  const progressEvent: TaskProgressEvent = {
    id: createId("task_progress"),
    companyId: input.task.companyId,
    departmentId: input.task.departmentId,
    parentTaskId: input.task.parentTaskId ?? input.task.id,
    subjectTaskId: input.task.id,
    step: "blocked",
    status: "waiting",
    label: reason,
    detail: request.why,
    createdAt: timestamp,
  };
  input.repositories.appendTaskProgressEvent(progressEvent);

  return { humanActionId, completionEvent, taskEvent, progressEvent };
}

/**
 * Credential vocabulary an Unblock Request must not use. Matched as words, in English and Chinese,
 * against what the request asks a person to supply — not against `why`, which may legitimately say a
 * source needs an account the run does not have.
 */
const CREDENTIAL_TERMS = /\b(passwords?|passwd|passphrases?|passcodes?|credentials?|api[\s_-]?keys?|access[\s_-]?keys?|secret[\s_-]?keys?|client[\s_-]?secrets?|private[\s_-]?keys?|ssh[\s_-]?keys?|(?:access|auth|bearer|session|refresh|api|personal[\s_-]?access)[\s_-]?tokens?|session[\s_-]?cookies?|cookies?|one[\s_-]?time[\s_-]?(?:code|password)s?|otp|2fa[\s_-]?codes?)\b|(密码|密钥|凭证|凭据|令牌|口令|验证码|私钥)/i;

export function credentialTermIn(text: string): string | null {
  return text.match(CREDENTIAL_TERMS)?.[0] ?? null;
}

/**
 * Value shapes that are a secret whatever field they were typed into: well-known key prefixes, JWTs,
 * PEM private keys, and `password=`/`api_key:` style assignments. A Human Action Confirmation carrying
 * one is refused, because confirmations become Settled Facts that every later run is given in its
 * prompt (ADR 0042: secrets are out of scope).
 */
const CREDENTIAL_VALUE_PATTERNS: Array<[string, RegExp]> = [
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["an API key", /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/],
  ["an API key", /\bAIza[0-9A-Za-z_-]{30,}/],
  ["an access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["a GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ["a Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["a JSON Web Token", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/],
  ["a credential assignment", /\b(?:password|passwd|pwd|api[_-]?key|secret|token|密码)\s*[:=]\s*\S+/i],
];

export function credentialLikeValue(value: string): string | null {
  return CREDENTIAL_VALUE_PATTERNS.find(([, pattern]) => pattern.test(value))?.[0] ?? null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
