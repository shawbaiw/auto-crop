import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locale } from "@auto-crop/core";
import { parseArtifactEnvelope, type ArtifactEnvelope } from "./artifactEnvelope";
import { artifactEnvelopeContractErrors } from "./businessArtifact";

export type RuntimeActionRunContext = {
  companyId: string;
  taskId: string;
  runId: string;
};

export type RuntimeActionTaskContext = Omit<RuntimeActionRunContext, "runId">;

/** The delivery contract settlement will hold this run's envelope to, so a submit can be told now. */
export type DeliveryContractOptions = {
  locale: Locale;
  requireDetails: boolean;
};

/**
 * What one run submitted: its last valid envelope, or — when no call was ever valid — the errors of
 * its last rejected call, so settlement can say why the delivery is invalid rather than missing.
 */
export type RunSubmission = {
  envelope: ArtifactEnvelope | null;
  rejection: string[] | null;
};

export type SubmitArtifactEnvelopeResult =
  | { ok: true; ignoredIdentityFields: string[] }
  | { ok: false; code: "invalid_artifact_envelope"; errors: string[]; ignoredIdentityFields: string[] };

/**
 * Run-local candidates for the Runtime Action Channel (ADR 0041). Not product state: settlement turns
 * a candidate into a Business Artifact, and nothing else reads one as a fact.
 *
 * Invariant: a task holds at most one candidate, its latest run's. Dispatch discards earlier runs'
 * candidates; a completed run's is consumed by its settlement; a run that did not complete keeps its
 * last valid one, which is what Proof recovery recaptures — the delivery that run left behind.
 * A rejected call never replaces a valid candidate.
 */
export type RuntimeActionChannel = {
  submitArtifactEnvelope(
    context: RuntimeActionRunContext,
    envelope: unknown,
    contract?: DeliveryContractOptions,
  ): SubmitArtifactEnvelopeResult;
  consumeRunSubmission(context: RuntimeActionRunContext): RunSubmission;
  /** What a task's latest run left behind, if it did not complete. */
  latestTaskSubmission(context: RuntimeActionTaskContext): RunSubmission;
  /** Drop every candidate of a task, at dispatch of a new run or once recovery has captured one. */
  discardTask(context: RuntimeActionTaskContext): void;
};

type Candidate = RunSubmission & {
  context: RuntimeActionRunContext;
};

const NOTHING_SUBMITTED: RunSubmission = { envelope: null, rejection: null };

export type RuntimeActionChannelOptions = {
  candidateDir?: string;
};

/** The project's file-backed channel: where the action server writes and settlement and recovery read. */
export function createProjectRuntimeActionChannel(projectRoot: string): RuntimeActionChannel {
  return createRuntimeActionChannel({ candidateDir: runtimeActionCandidateDir(projectRoot) });
}

export function runtimeActionCandidateDir(projectRoot: string): string {
  return join(projectRoot, ".auto-crop", "runtime-actions");
}

export function createRuntimeActionChannel(options: RuntimeActionChannelOptions = {}): RuntimeActionChannel {
  const candidates = new Map<string, Candidate>();
  const taskCandidates = (context: RuntimeActionTaskContext): Candidate[] => options.candidateDir
    ? readTaskCandidates(options.candidateDir, context)
    : [...candidates.values()].filter((candidate) => sameTask(candidate.context, context));

  const store = (candidate: Candidate): void => {
    if (!options.candidateDir) {
      candidates.set(key(candidate.context), candidate);
    }
    writeCandidate(options.candidateDir, candidate);
  };

  return {
    submitArtifactEnvelope(context, envelope, contract) {
      const parsed = parseArtifactEnvelope(envelope);
      const errors = parsed.success
        ? contract ? artifactEnvelopeContractErrors(parsed.value, contract) : []
        : parsed.errors;
      if (!parsed.success || errors.length > 0) {
        // The last valid call stays the delivery; a rejection is only kept while there is none.
        const existing = candidates.get(key(context)) ?? readCandidate(options.candidateDir, context);
        if (!existing?.envelope) {
          store({ context: { ...context }, envelope: null, rejection: errors });
        }
        return {
          ok: false,
          code: "invalid_artifact_envelope",
          errors,
          ignoredIdentityFields: parsed.ignoredIdentityFields,
        };
      }
      store({ context: { ...context }, envelope: parsed.value, rejection: null });
      return { ok: true, ignoredIdentityFields: parsed.ignoredIdentityFields };
    },
    consumeRunSubmission(context) {
      const id = key(context);
      const candidate = candidates.get(id) ?? readCandidate(options.candidateDir, context);
      candidates.delete(id);
      deleteCandidate(options.candidateDir, context);
      return candidate && sameContext(candidate.context, context) ? submissionOf(candidate) : NOTHING_SUBMITTED;
    },
    latestTaskSubmission(context) {
      const candidate = taskCandidates(context)[0];
      return candidate ? submissionOf(candidate) : NOTHING_SUBMITTED;
    },
    discardTask(context) {
      for (const candidate of taskCandidates(context)) {
        candidates.delete(key(candidate.context));
        deleteCandidate(options.candidateDir, candidate.context);
      }
    },
  };
}

function submissionOf(candidate: Candidate): RunSubmission {
  return { envelope: candidate.envelope ?? null, rejection: candidate.envelope ? null : candidate.rejection ?? null };
}

function key(context: RuntimeActionRunContext): string {
  return `${context.companyId}\0${context.taskId}\0${context.runId}`;
}

function sameContext(left: RuntimeActionRunContext | undefined, right: RuntimeActionRunContext): boolean {
  return Boolean(left && left.companyId === right.companyId && left.taskId === right.taskId && left.runId === right.runId);
}

function sameTask(left: RuntimeActionTaskContext, right: RuntimeActionTaskContext): boolean {
  return left.companyId === right.companyId && left.taskId === right.taskId;
}

function writeCandidate(candidateDir: string | undefined, candidate: Candidate): void {
  if (!candidateDir) {
    return;
  }
  mkdirSync(candidateDir, { recursive: true });
  writeFileSync(candidatePath(candidateDir, candidate.context), `${JSON.stringify(candidate)}\n`, "utf8");
}

function readCandidate(candidateDir: string | undefined, context: RuntimeActionRunContext): Candidate | null {
  if (!candidateDir) {
    return null;
  }
  const path = candidatePath(candidateDir, context);
  if (!existsSync(path)) {
    return null;
  }
  const parsed = readCandidateFile(path);
  return parsed && sameContext(parsed.context, context) ? parsed : null;
}

/** File names are lossy (`safeSegment`), so a match is confirmed against the context stored inside. */
function readTaskCandidates(candidateDir: string, context: RuntimeActionTaskContext): Candidate[] {
  if (!existsSync(candidateDir)) {
    return [];
  }
  const prefix = `${safeSegment(context.companyId)}-${safeSegment(context.taskId)}-`;
  return readdirSync(candidateDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .map((name) => readCandidateFile(join(candidateDir, name)))
    .filter((candidate): candidate is Candidate => Boolean(candidate && sameTask(candidate.context, context)));
}

function readCandidateFile(path: string): Candidate | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Candidate;
  } catch {
    return null;
  }
}

function deleteCandidate(candidateDir: string | undefined, context: RuntimeActionRunContext): void {
  if (!candidateDir) {
    return;
  }
  rmSync(candidatePath(candidateDir, context), { force: true });
}

function candidatePath(candidateDir: string, context: RuntimeActionRunContext): string {
  return join(candidateDir, `${safeSegment(context.companyId)}-${safeSegment(context.taskId)}-${safeSegment(context.runId)}.json`);
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
