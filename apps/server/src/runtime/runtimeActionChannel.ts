import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArtifactEnvelope, type ArtifactEnvelope } from "./artifactEnvelope";

export type RuntimeActionRunContext = {
  companyId: string;
  taskId: string;
  runId: string;
};

export type SubmitArtifactEnvelopeResult =
  | { ok: true; ignoredIdentityFields: string[] }
  | { ok: false; code: "invalid_artifact_envelope"; errors: string[]; ignoredIdentityFields: string[] };

export type RuntimeActionChannel = {
  submitArtifactEnvelope(context: RuntimeActionRunContext, envelope: unknown): SubmitArtifactEnvelopeResult;
  consumeArtifactEnvelopeCandidate(context: RuntimeActionRunContext): ArtifactEnvelope | null;
  discardRun(context: RuntimeActionRunContext): void;
};

type Candidate = {
  context: RuntimeActionRunContext;
  envelope: ArtifactEnvelope;
};

export type RuntimeActionChannelOptions = {
  candidateDir?: string;
};

export function createRuntimeActionChannel(options: RuntimeActionChannelOptions = {}): RuntimeActionChannel {
  const candidates = new Map<string, Candidate>();

  return {
    submitArtifactEnvelope(context, envelope) {
      const parsed = parseArtifactEnvelope(envelope);
      if (!parsed.success) {
        return {
          ok: false,
          code: "invalid_artifact_envelope",
          errors: parsed.errors,
          ignoredIdentityFields: parsed.ignoredIdentityFields,
        };
      }
      const candidate = { context: { ...context }, envelope: parsed.value };
      if (!options.candidateDir) {
        candidates.set(key(context), candidate);
      }
      writeCandidate(options.candidateDir, candidate);
      return { ok: true, ignoredIdentityFields: parsed.ignoredIdentityFields };
    },
    consumeArtifactEnvelopeCandidate(context) {
      const id = key(context);
      const candidate = candidates.get(id) ?? readCandidate(options.candidateDir, context);
      candidates.delete(id);
      deleteCandidate(options.candidateDir, context);
      return candidate && sameContext(candidate.context, context) ? candidate.envelope : null;
    },
    discardRun(context) {
      candidates.delete(key(context));
      deleteCandidate(options.candidateDir, context);
    },
  };
}

function key(context: RuntimeActionRunContext): string {
  return `${context.companyId}\0${context.taskId}\0${context.runId}`;
}

function sameContext(left: RuntimeActionRunContext | undefined, right: RuntimeActionRunContext): boolean {
  return Boolean(left && left.companyId === right.companyId && left.taskId === right.taskId && left.runId === right.runId);
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
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Candidate;
    return sameContext(parsed.context, context) ? parsed : null;
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
