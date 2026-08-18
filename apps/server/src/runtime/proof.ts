import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Proof, ProofSchema, ProofType, Task } from "@auto-crop/core";

export type CaptureProofsInput = {
  task: Task;
  proofSchema: ProofSchema;
  workspacePath: string;
  logPath: string;
  stdout: string;
  stderr: string;
  declaredFiles?: string[];
  screenshots?: string[];
  urls?: string[];
  deploymentUrls?: string[];
  diffText?: string;
  createId?: (prefix: string) => string;
};

export type CreateProofCollectorInput = {
  proofSchemas: ProofSchema[];
  createId?: (prefix: string) => string;
};

export type ProofManifest = {
  status?: string;
  summary?: string;
  files?: string[];
  artifactPaths?: string[];
  screenshots?: string[];
  urls?: string[];
  deploymentUrls?: string[];
};

export function captureProofs(input: CaptureProofsInput): Proof[] {
  if (input.task.proofSchemaId !== input.proofSchema.id) {
    throw new Error(
      `Proof schema ${input.proofSchema.id} does not match task proof schema ${input.task.proofSchemaId}.`,
    );
  }

  const createId = input.createId ?? defaultCreateId;
  const proof: Proof[] = [];

  for (const declaredFile of input.declaredFiles ?? []) {
    if (!accepts(input.proofSchema, "file")) {
      continue;
    }

    const filePath = resolvePathInsideWorkspace(input.workspacePath, declaredFile);

    if (existsSync(filePath)) {
      proof.push({
        id: createId("proof"),
        taskId: input.task.id,
        type: "file",
        uri: filePath,
        summary: `File proof: ${declaredFile}`,
        verifiedAt: null,
      });
    }
  }

  for (const screenshot of input.screenshots ?? []) {
    if (!accepts(input.proofSchema, "screenshot")) {
      continue;
    }

    const screenshotPath = resolvePathInsideWorkspace(input.workspacePath, screenshot);

    if (existsSync(screenshotPath)) {
      proof.push({
        id: createId("proof"),
        taskId: input.task.id,
        type: "screenshot",
        uri: screenshotPath,
        summary: `Screenshot proof: ${screenshot}`,
        verifiedAt: null,
      });
    }
  }

  if (input.diffText && accepts(input.proofSchema, "diff")) {
    const proofDir = join(input.workspacePath, ".auto-crop-proof");
    mkdirSync(proofDir, { recursive: true });
    const diffPath = join(proofDir, `${input.task.id}.diff`);
    writeFileSync(diffPath, input.diffText, "utf8");
    proof.push({
      id: createId("proof"),
      taskId: input.task.id,
      type: "diff",
      uri: diffPath,
      summary: "Diff proof captured.",
      verifiedAt: null,
    });
  }

  if (input.stdout.trim().length > 0 && accepts(input.proofSchema, "command_output")) {
    proof.push({
      id: createId("proof"),
      taskId: input.task.id,
      type: "command_output",
      uri: input.logPath,
      summary: "Command output proof captured.",
      verifiedAt: null,
    });
  }

  for (const url of input.urls ?? []) {
    if (!accepts(input.proofSchema, "url")) {
      continue;
    }

    proof.push({
      id: createId("proof"),
      taskId: input.task.id,
      type: "url",
      uri: url,
      summary: `URL proof: ${url}`,
      verifiedAt: null,
    });
  }

  for (const deploymentUrl of input.deploymentUrls ?? []) {
    if (!accepts(input.proofSchema, "deployment")) {
      continue;
    }

    proof.push({
      id: createId("proof"),
      taskId: input.task.id,
      type: "deployment",
      uri: deploymentUrl,
      summary: `Deployment proof: ${deploymentUrl}`,
      verifiedAt: null,
    });
  }

  return proof;
}

export function createProofCollector(input: CreateProofCollectorInput) {
  const proofSchemasById = new Map(input.proofSchemas.map((proofSchema) => [proofSchema.id, proofSchema]));

  return (run: { task: Task; stdout: string; stderr: string; logPath: string }): Proof[] => {
    const proofSchema = proofSchemasById.get(run.task.proofSchemaId);

    if (!proofSchema) {
      throw new Error(`No proof schema configured for task proof schema: ${run.task.proofSchemaId}`);
    }

    if (!run.task.workspacePath) {
      throw new Error(`Task ${run.task.id} has no workspace path for proof capture.`);
    }

    const manifest = readProofManifest(run.task.workspacePath);
    const artifactFiles = listArtifactFiles(run.task.workspacePath);
    const declaredFiles = unique([
      ...artifactFiles,
      ...(manifest.files ?? []),
      ...(manifest.artifactPaths ?? []),
    ]);

    return captureProofs({
      task: run.task,
      proofSchema,
      workspacePath: run.task.workspacePath,
      logPath: run.logPath,
      stdout: run.stdout,
      stderr: run.stderr,
      declaredFiles,
      screenshots: manifest.screenshots,
      urls: manifest.urls,
      deploymentUrls: manifest.deploymentUrls,
      createId: input.createId,
    });
  };
}

function accepts(proofSchema: ProofSchema, proofType: ProofType): boolean {
  return proofSchema.acceptedTypes.includes(proofType);
}

function resolvePathInsideWorkspace(workspacePath: string, pathWithinWorkspace: string): string {
  const normalizedWorkspace = resolve(workspacePath);
  const candidate = resolve(normalizedWorkspace, pathWithinWorkspace);
  const relativePath = relative(normalizedWorkspace, candidate);

  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return candidate;
  }

  throw new Error(`Proof path resolves outside workspace: ${pathWithinWorkspace}`);
}

function readProofManifest(workspacePath: string): ProofManifest {
  const manifestPath = join(workspacePath, "proof.json");

  if (!existsSync(manifestPath)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as ProofManifest;

  return {
    status: parsed.status,
    summary: parsed.summary,
    files: filterStringArray(parsed.files),
    artifactPaths: filterStringArray(parsed.artifactPaths),
    screenshots: filterStringArray(parsed.screenshots),
    urls: filterStringArray(parsed.urls),
    deploymentUrls: filterStringArray(parsed.deploymentUrls),
  };
}

function listArtifactFiles(workspacePath: string): string[] {
  const artifactsDir = join(workspacePath, "artifacts");

  if (!existsSync(artifactsDir)) {
    return [];
  }

  const files: string[] = [];
  const pending = ["artifacts"];

  while (pending.length > 0) {
    const relativeDir = pending.pop();

    if (!relativeDir) {
      continue;
    }

    for (const entry of readdirSync(join(workspacePath, relativeDir))) {
      const relativeEntry = join(relativeDir, entry);
      const absoluteEntry = resolvePathInsideWorkspace(workspacePath, relativeEntry);
      const stats = statSync(absoluteEntry);

      if (stats.isDirectory()) {
        pending.push(relativeEntry);
        continue;
      }

      if (stats.isFile()) {
        files.push(relativeEntry);
      }
    }
  }

  return files.sort();
}

function filterStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
