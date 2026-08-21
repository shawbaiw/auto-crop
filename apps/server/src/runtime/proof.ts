import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

    const declaredFiles = collectDeclaredFilesForSchema(proofSchema, run.task.workspacePath);
    maybeWriteStdoutFileProof({
      proofSchema,
      stdout: run.stdout,
      workspacePath: run.task.workspacePath,
      declaredFiles,
    });
    const urlProof = extractUrlProof(run.stdout);

    return captureProofs({
      task: run.task,
      proofSchema,
      workspacePath: run.task.workspacePath,
      logPath: run.logPath,
      stdout: run.stdout,
      stderr: run.stderr,
      declaredFiles,
      urls: urlProof.urls,
      deploymentUrls: urlProof.deploymentUrls,
      createId: input.createId,
    });
  };
}

function extractUrlProof(stdout: string): { urls: string[]; deploymentUrls: string[] } {
  const candidates = stdout.match(/https?:\/\/[^\s<>)\]]+/g) ?? [];
  const urls: string[] = [];
  const deploymentUrls: string[] = [];

  for (const candidate of candidates) {
    const url = trimTrailingUrlPunctuation(candidate);

    if (!isValidUrl(url)) {
      continue;
    }

    if (isLocalUrl(url)) {
      urls.push(url);
    } else {
      deploymentUrls.push(url);
    }
  }

  return {
    urls: dedupe(urls),
    deploymentUrls: dedupe(deploymentUrls),
  };
}

function trimTrailingUrlPunctuation(url: string): string {
  return url.replace(/[.,;:'"`]+$/u, "");
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isLocalUrl(value: string): boolean {
  const hostname = new URL(value).hostname;

  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "[::1]";
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function collectDeclaredFilesForSchema(proofSchema: ProofSchema, workspacePath: string): string[] {
  if (!accepts(proofSchema, "file")) {
    return [];
  }

  if (proofSchema.id === "landing-page-file") {
    return ["index.html", "src/main.tsx", "src/App.tsx", "app/page.tsx"].filter((path) =>
      existsSync(resolvePathInsideWorkspace(workspacePath, path)),
    );
  }

  return [stdoutProofFileName(proofSchema.id)];
}

function maybeWriteStdoutFileProof(input: {
  proofSchema: ProofSchema;
  stdout: string;
  workspacePath: string;
  declaredFiles: string[];
}): void {
  const stdout = input.stdout.trim();

  if (!stdout || !accepts(input.proofSchema, "file") || input.proofSchema.id === "landing-page-file") {
    return;
  }

  const proofFile = input.declaredFiles[0] ?? stdoutProofFileName(input.proofSchema.id);
  const proofPath = resolvePathInsideWorkspace(input.workspacePath, proofFile);

  if (!existsSync(proofPath)) {
    writeFileSync(proofPath, `${stdout}\n`, "utf8");
  }
}

function stdoutProofFileName(proofSchemaId: string): string {
  switch (proofSchemaId) {
    case "product-brief":
      return "product-brief.md";
    case "research-report":
      return "research-report.md";
    default:
      return "task-output.md";
  }
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

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
