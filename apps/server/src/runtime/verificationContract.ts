import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  deriveVerificationOutcome,
  type ArtifactVerification,
  type BusinessArtifact,
  type DependencyInputRole,
  type Task,
  type VerificationCheck,
  type VerificationCheckOutcome,
  type VerificationInputs,
  type VerificationRequirement,
  type VerificationSnapshotTarget,
} from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";

type Repositories = ReturnType<typeof createRepositories>;

/** Where a verifying task's runtime-made input snapshots live, relative to its own workspace. */
export const VERIFICATION_INPUTS_DIR = ".auto-crop-inputs";

/**
 * Directories and files never handed over. Runtime bookkeeping is not the producer's output, VCS and
 * dependency caches are not what is being verified, and env files may hold credentials.
 */
const EXCLUDED_DIRECTORY_NAMES = new Set([".auto-crop", ".auto-crop-handoff", VERIFICATION_INPUTS_DIR, ".git", "node_modules"]);
const MAX_SNAPSHOT_FILES = 5_000;
const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;

export type PrepareVerificationInputsResult =
  | { kind: "not_verifier" }
  | { kind: "ready"; inputs: VerificationInputs }
  | { kind: "handoff_failed"; producer: Task; message: string };

/** How a capture must treat the artifact of this task under the Verification Contract. */
export type CaptureVerificationContext = {
  /** A consumer takes this task's output as its verification requirements. */
  producesRequirements: boolean;
  /**
   * This task verifies upstream output. `inputs` is what the runtime persisted at dispatch, null when it
   * handed nothing over. `snapshotRevisions` is each snapshot re-fingerprinted at capture time.
   */
  verifier: {
    inputs: VerificationInputs | null;
    currentArtifactIds: Map<string, string | null>;
    snapshotRevisions: Map<string, string | null>;
  } | null;
};

export function dependenciesWithRole(repositories: Repositories, taskId: string, role: DependencyInputRole) {
  return repositories.listTaskDependencies(taskId).filter((dependency) => (dependency.inputRole ?? "context") === role);
}

/**
 * Whether a task carries verification duty. Decided by its declared dependencies — never by what kind of
 * artifact its agent chose to file, which is exactly the choice a verifier could use to skip the contract.
 */
export function isVerifyingTask(repositories: Repositories, task: Pick<Task, "id">): boolean {
  return dependenciesWithRole(repositories, task.id, "verification_target").length > 0;
}

export function producesVerificationRequirements(repositories: Repositories, task: Task): boolean {
  return repositories
    .listTaskDependenciesForCompany(task.companyId)
    .some((dependency) => dependency.dependsOnTaskId === task.id && dependency.inputRole === "verification_requirements");
}

export function resolveCaptureVerificationContext(
  repositories: Repositories,
  task: Task,
  workspacePath: string,
): CaptureVerificationContext {
  const producesRequirements = producesVerificationRequirements(repositories, task);
  if (!isVerifyingTask(repositories, task)) {
    return { producesRequirements, verifier: null };
  }

  const inputs = repositories.getVerificationInputs(task.id);
  const producerIds = [
    ...(inputs?.targets.map((target) => target.taskId) ?? []),
    ...(inputs?.requirementsTaskId ? [inputs.requirementsTaskId] : []),
  ];
  const currentArtifactIds = new Map(
    producerIds.map((producerId) => [producerId, repositories.getCurrentBusinessArtifactForTask(producerId)?.id ?? null]),
  );
  const snapshotRevisions = new Map(
    (inputs?.targets ?? []).map((target) => [target.taskId, fingerprintDirectory(join(workspacePath, target.path))]),
  );
  return { producesRequirements, verifier: { inputs, currentArtifactIds, snapshotRevisions } };
}

/**
 * Whether the producer outputs a verdict was bound to are still the current ones. A verdict about a
 * superseded output says nothing about the output downstream would now consume, so acceptance and
 * readiness ask this alongside the verdict itself.
 */
export function isVerificationCurrent(repositories: Repositories, artifact: Pick<BusinessArtifact, "verification">): boolean {
  const verification = artifact.verification;
  if (!verification) {
    return true;
  }
  const targetsCurrent = verification.targets.every(
    (target) => repositories.getCurrentBusinessArtifactForTask(target.taskId)?.id === target.artifactId,
  );
  const requirementsCurrent = !verification.requirementsTaskId ||
    repositories.getCurrentBusinessArtifactForTask(verification.requirementsTaskId)?.id === verification.requirementsArtifactId;
  return targetsCurrent && requirementsCurrent;
}

/**
 * Hand a verifying task exactly what it verifies: the requirements from its `verification_requirements`
 * producer, and a fresh snapshot of every `verification_target` producer's output inside its own
 * workspace, each fingerprinted from the snapshot's bytes.
 *
 * What was handed over is persisted in the database, not the workspace: the workspace is the agent's to
 * write, and a manifest read back from it would let a verifier drop the requirements it is judged against.
 * A verifier never runs against a producer's live workspace, and anything missing is a named handoff
 * failure before the run starts — never an empty directory the agent then reports on.
 */
export function prepareVerificationInputs(input: {
  repositories: Repositories;
  task: Task;
  workspacePath: string;
  now?: () => Date;
}): PrepareVerificationInputsResult {
  const targetDependencies = dependenciesWithRole(input.repositories, input.task.id, "verification_target");
  if (targetDependencies.length === 0) {
    return { kind: "not_verifier" };
  }

  // Whatever an earlier dispatch handed over no longer describes this one, including when this one fails.
  input.repositories.clearVerificationInputs(input.task.id);
  const inputsRoot = join(input.workspacePath, VERIFICATION_INPUTS_DIR);
  rmSync(inputsRoot, { force: true, recursive: true });
  mkdirSync(inputsRoot, { recursive: true });

  const requirementDependencies = dependenciesWithRole(input.repositories, input.task.id, "verification_requirements");
  let requirementsTaskId: string | null = null;
  let requirementsArtifactId: string | null = null;
  const requirements: VerificationRequirement[] = [];
  if (requirementDependencies.length > 1) {
    return {
      kind: "handoff_failed",
      producer: input.task,
      message: `Handoff failed: ${input.task.title} declares more than one verification requirements source.`,
    };
  }
  for (const dependency of requirementDependencies) {
    const producer = input.repositories.getTask(dependency.dependsOnTaskId);
    if (!producer) {
      continue;
    }
    const artifact = input.repositories.getCurrentBusinessArtifactForTask(producer.id);
    const parsed = artifact ? parseVerificationRequirements(artifact.payload) : null;
    if (!artifact || !parsed || parsed.errors.length > 0 || parsed.requirements.length === 0) {
      return {
        kind: "handoff_failed",
        producer,
        message: `Handoff failed: ${producer.title} has no current verification requirements for ${input.task.title}.`,
      };
    }
    requirementsTaskId = producer.id;
    requirementsArtifactId = artifact.id;
    requirements.push(...parsed.requirements);
  }
  if (requirements.length === 0) {
    const producer = input.repositories.getTask(targetDependencies[0]!.dependsOnTaskId)!;
    return {
      kind: "handoff_failed",
      producer,
      message: `Handoff failed: ${input.task.title} verifies ${producer.title} but no upstream declares its verification requirements.`,
    };
  }

  const targets: VerificationSnapshotTarget[] = [];
  for (const dependency of targetDependencies) {
    const producer = input.repositories.getTask(dependency.dependsOnTaskId);
    const artifact = producer ? input.repositories.getCurrentBusinessArtifactForTask(producer.id) : null;
    if (!producer || !artifact) {
      return {
        kind: "handoff_failed",
        producer: producer ?? input.task,
        message: `Handoff failed: verification target ${dependency.dependsOnTaskId} has no current Business Artifact.`,
      };
    }

    const snapshot = snapshotProducerOutput({ producer, artifact, inputsRoot });
    if (snapshot.kind === "failed") {
      return { kind: "handoff_failed", producer, message: `Handoff failed: ${producer.title} / ${snapshot.message}` };
    }
    const revision = fingerprintDirectory(snapshot.directory);
    if (!revision) {
      return { kind: "handoff_failed", producer, message: `Handoff failed: ${producer.title} / snapshot could not be fingerprinted.` };
    }
    targets.push({
      taskId: producer.id,
      artifactId: artifact.id,
      revision,
      path: relative(input.workspacePath, snapshot.directory).split(sep).join("/"),
    });
  }

  const inputs: VerificationInputs = { requirementsTaskId, requirementsArtifactId, requirements, targets };
  input.repositories.saveVerificationInputs(input.task.id, inputs, (input.now ?? (() => new Date()))().toISOString());
  return { kind: "ready", inputs };
}

/**
 * Fingerprint a snapshot directory from its contents: every file's relative path and bytes, in a stable
 * order. Computed once when the snapshot is made and again when the report is captured, so a snapshot
 * altered during the run cannot back a verdict. Returns null when the directory is missing or holds
 * anything other than regular files and directories.
 */
export function fingerprintDirectory(root: string): string | null {
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    return null;
  }
  const digest = createHash("sha256");
  const walk = (current: string): boolean => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(current, entry.name);
      const relativePath = relative(root, absolute).split(sep).join("/");
      if (entry.isDirectory()) {
        digest.update(`dir\0${relativePath}\0`);
        if (!walk(absolute)) {
          return false;
        }
      } else if (entry.isFile()) {
        digest.update(`file\0${relativePath}\0${createHash("sha256").update(readFileSync(absolute)).digest("hex")}\0`);
      } else {
        return false;
      }
    }
    return true;
  };
  return walk(root) ? digest.digest("hex") : null;
}

function snapshotProducerOutput(input: {
  producer: Task;
  artifact: BusinessArtifact;
  inputsRoot: string;
}): { kind: "ready"; directory: string } | { kind: "failed"; message: string } {
  const directory = join(input.inputsRoot, input.producer.id);
  mkdirSync(directory, { recursive: true });

  // The accepted artifact record is part of what was delivered, and it comes from the database, not
  // from a file the producer's workspace may since have overwritten.
  const artifactRecord = JSON.stringify(
    {
      id: input.artifact.id,
      artifactKind: input.artifact.artifactKind,
      artifactRole: input.artifact.artifactRole,
      artifactSubtype: input.artifact.artifactSubtype,
      taskType: input.artifact.taskType,
      payload: input.artifact.payload,
    },
    null,
    2,
  );
  writeFileSync(join(directory, "business-artifact.json"), `${artifactRecord}\n`, "utf8");

  const sourceRoot = input.producer.artifactWorkspacePath;
  if (!sourceRoot) {
    return { kind: "ready", directory };
  }
  if (!existsSync(sourceRoot) || !lstatSync(sourceRoot).isDirectory()) {
    return { kind: "failed", message: `artifact workspace ${sourceRoot} is missing.` };
  }

  const filesDirectory = join(directory, "files");
  const files: string[] = [];
  const walk = (current: string): string | null => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }
        const failure = walk(absolute);
        if (failure) {
          return failure;
        }
        continue;
      }
      if (entry.isSymbolicLink()) {
        return `symbolic link ${relative(sourceRoot, absolute)} is not handed over.`;
      }
      if (!entry.isFile() || entry.name === ".env" || entry.name.startsWith(".env.")) {
        continue;
      }
      files.push(absolute);
    }
    return null;
  };
  const walkFailure = walk(sourceRoot);
  if (walkFailure) {
    return { kind: "failed", message: walkFailure };
  }
  if (files.length > MAX_SNAPSHOT_FILES) {
    return { kind: "failed", message: `artifact workspace has ${files.length} files, above the ${MAX_SNAPSHOT_FILES} handoff limit.` };
  }

  let totalBytes = 0;
  for (const absolute of files) {
    const relativePath = relative(sourceRoot, absolute).split(sep).join("/");
    let content: Buffer;
    try {
      content = readFileSync(absolute);
    } catch (error) {
      return { kind: "failed", message: `file ${relativePath} is not readable: ${(error as Error).message}` };
    }
    totalBytes += content.byteLength;
    if (totalBytes > MAX_SNAPSHOT_BYTES) {
      return { kind: "failed", message: `artifact workspace exceeds the ${MAX_SNAPSHOT_BYTES} byte handoff limit.` };
    }
    const destination = join(filesDirectory, relativePath);
    mkdirSync(join(destination, ".."), { recursive: true });
    writeFileSync(destination, content);
  }

  return { kind: "ready", directory };
}

/** Read `payload.verification_requirements`. Ids must be unique, non-empty and carry a description. */
export function parseVerificationRequirements(payload: unknown): { requirements: VerificationRequirement[]; errors: string[] } {
  const value = isRecord(payload) ? payload.verification_requirements ?? payload.verificationRequirements : undefined;
  if (!Array.isArray(value)) {
    return { requirements: [], errors: ["payload.verification_requirements: Expected a non-empty array."] };
  }

  const errors: string[] = [];
  const requirements: VerificationRequirement[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const id = isRecord(entry) && typeof entry.id === "string" ? entry.id.trim() : "";
    const description = isRecord(entry) && typeof entry.description === "string" ? entry.description.trim() : "";
    if (!id) {
      errors.push(`payload.verification_requirements[${index}].id: Expected a non-empty string.`);
      return;
    }
    if (!description) {
      errors.push(`payload.verification_requirements[${index}].description: Expected a non-empty string.`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`payload.verification_requirements[${index}].id: Duplicate id ${id}.`);
      return;
    }
    seen.add(id);
    requirements.push({ id, description });
  });
  if (value.length === 0) {
    errors.push("payload.verification_requirements: Expected a non-empty array.");
  }
  return { requirements, errors };
}

const CHECK_OUTCOMES = new Set<VerificationCheckOutcome>(["passed", "failed", "not_run"]);

/**
 * Bind a verifying run's report to the inputs it was handed and derive the verdict.
 *
 * Shape errors — no `verification.checks`, an unknown or duplicated requirement, a requirement left out,
 * a check without evidence — make the report invalid, like any other contract violation: a verifier may
 * say it could not run a check (`not_run`), but not silently drop it. A well-formed report yields a
 * verdict. A target or requirement source that changed since the snapshot is an issue, so the verdict
 * cannot be `passed` for a version nobody verified.
 */
export function evaluateVerificationReport(input: {
  payload: unknown;
  context: NonNullable<CaptureVerificationContext["verifier"]>;
}): { errors: string[]; verification: ArtifactVerification | null } {
  const { inputs, currentArtifactIds } = input.context;
  if (!inputs) {
    return {
      errors: [],
      verification: {
        outcome: "inconclusive",
        requirementsArtifactId: null,
        requirements: [],
        targets: [],
        checks: [],
        issues: ["The runtime handed this verifier no inputs, so the report is bound to nothing."],
      },
    };
  }

  const errors: string[] = [];
  const verificationValue = isRecord(input.payload) ? input.payload.verification : undefined;
  const checksValue = isRecord(verificationValue) ? verificationValue.checks : undefined;
  if (!Array.isArray(checksValue)) {
    return { errors: ["payload.verification.checks: Expected an array with one check per requirement."], verification: null };
  }

  const requirementIds = new Set(inputs.requirements.map((requirement) => requirement.id));
  const checks: VerificationCheck[] = [];
  const checked = new Set<string>();
  checksValue.forEach((entry, index) => {
    const requirementId = isRecord(entry) ? (entry.requirement_id ?? entry.requirementId) : undefined;
    const outcome = isRecord(entry) ? entry.outcome : undefined;
    const evidence = isRecord(entry) && typeof entry.evidence === "string" ? entry.evidence.trim() : "";
    if (typeof requirementId !== "string" || !requirementIds.has(requirementId)) {
      errors.push(`payload.verification.checks[${index}].requirement_id: Expected one of the handed-over requirement ids.`);
      return;
    }
    if (checked.has(requirementId)) {
      errors.push(`payload.verification.checks[${index}].requirement_id: Duplicate check for ${requirementId}.`);
      return;
    }
    if (typeof outcome !== "string" || !CHECK_OUTCOMES.has(outcome as VerificationCheckOutcome)) {
      errors.push(`payload.verification.checks[${index}].outcome: Expected passed, failed or not_run.`);
      return;
    }
    if (!evidence) {
      errors.push(`payload.verification.checks[${index}].evidence: Expected a non-empty string.`);
      return;
    }
    checked.add(requirementId);
    checks.push({ requirementId, outcome: outcome as VerificationCheckOutcome, evidence });
  });
  for (const requirement of inputs.requirements) {
    if (!checked.has(requirement.id) && !errors.some((error) => error.includes(requirement.id))) {
      errors.push(`payload.verification.checks: Missing a check for requirement ${requirement.id}.`);
    }
  }
  if (errors.length > 0) {
    return { errors, verification: null };
  }

  const issues: string[] = [];
  for (const target of inputs.targets) {
    if (currentArtifactIds.get(target.taskId) !== target.artifactId) {
      issues.push(`Target ${target.taskId} changed since it was snapshotted (verified ${target.artifactId}).`);
    }
    if (input.context.snapshotRevisions.get(target.taskId) !== target.revision) {
      issues.push(`Snapshot of ${target.taskId} was modified or removed during verification.`);
    }
  }
  if (inputs.requirementsTaskId && currentArtifactIds.get(inputs.requirementsTaskId) !== inputs.requirementsArtifactId) {
    issues.push(`Verification requirements changed since they were handed over (used ${inputs.requirementsArtifactId}).`);
  }

  return {
    errors: [],
    verification: {
      outcome: deriveVerificationOutcome({ requirements: inputs.requirements, checks, issues }),
      requirementsTaskId: inputs.requirementsTaskId,
      requirementsArtifactId: inputs.requirementsArtifactId,
      requirements: inputs.requirements,
      targets: inputs.targets.map(({ taskId, artifactId, revision }) => ({ taskId, artifactId, revision })),
      checks,
      issues,
    },
  };
}

/** Founder-readable reason a verification did not pass, naming the checks that failed or did not run. */
export function verificationFailureMessage(task: Task, verification: ArtifactVerification): string {
  const failed = verification.checks.filter((check) => check.outcome === "failed").map((check) => check.requirementId);
  const notRun = verification.checks.filter((check) => check.outcome === "not_run").map((check) => check.requirementId);
  const details = [
    failed.length > 0 ? `failed: ${failed.join(", ")}` : null,
    notRun.length > 0 ? `not run: ${notRun.join(", ")}` : null,
    ...verification.issues,
  ].filter((detail): detail is string => Boolean(detail));
  return `Task blocked: ${task.title} / verification_failed / ${verification.outcome}${details.length > 0 ? ` / ${details.join(" / ")}` : ""}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
