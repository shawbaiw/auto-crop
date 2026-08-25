import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
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

export type HandoffPackage = {
  manifestPath: string;
  packageDir: string;
};

export type CreateHandoffPackageInput = {
  task: Task;
  proofs: Proof[];
  workspacePath: string;
  logPath: string;
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
  } else if (accepts(input.proofSchema, "diff")) {
    const recoveredDiff = recoverControlledDiffProof(input.workspacePath);
    if (recoveredDiff) {
      const proofDir = join(input.workspacePath, ".auto-crop-proof");
      mkdirSync(proofDir, { recursive: true });
      const diffPath = join(proofDir, `${input.task.id}.diff`);
      writeFileSync(diffPath, recoveredDiff.content, "utf8");
      proof.push({
        id: createId("proof"),
        taskId: input.task.id,
        type: "diff",
        uri: diffPath,
        summary: `Diff proof recovered from ${recoveredDiff.sourceNames.join(", ")}.`,
        verifiedAt: null,
      });
    }
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

export function createHandoffPackage(input: CreateHandoffPackageInput): HandoffPackage | null {
  if (input.proofs.length === 0) {
    return null;
  }

  const packageDir = join(input.workspacePath, ".auto-crop-handoff");
  const artifactsDir = join(packageDir, "artifacts");
  rmSync(packageDir, { force: true, recursive: true });
  mkdirSync(artifactsDir, { recursive: true });

  const artifacts = input.proofs.flatMap((proof, index) => {
    if (!isCopyableLocalArtifact(proof.uri)) {
      return [];
    }

    const sourcePath = resolveCopyableArtifactPath(input.workspacePath, proof.uri);

    if (!sourcePath || !existsSync(sourcePath)) {
      return [];
    }

    const artifactName = `${String(index + 1).padStart(2, "0")}-${sanitizeArtifactName(basename(sourcePath))}`;
    const packagePath = join(artifactsDir, artifactName);
    copyFileSync(sourcePath, packagePath);

    return [
      {
        proofId: proof.id,
        proofType: proof.type,
        sourceUri: proof.uri,
        packagePath,
      },
    ];
  });

  const manifestPath = join(packageDir, "package.json");
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        task: {
          id: input.task.id,
          title: input.task.title,
          proofSchemaId: input.task.proofSchemaId,
        },
        proofs: input.proofs.map((proof) => ({
          id: proof.id,
          type: proof.type,
          uri: proof.uri,
          summary: proof.summary,
        })),
        artifacts,
        logPath: input.logPath,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return { manifestPath, packageDir };
}

export function getHandoffPackageManifestPath(task: Pick<Task, "workspacePath">): string | null {
  if (!task.workspacePath) {
    return null;
  }

  const manifestPath = join(task.workspacePath, ".auto-crop-handoff", "package.json");
  return existsSync(manifestPath) ? manifestPath : null;
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

function recoverControlledDiffProof(workspacePath: string): { content: string; sourceNames: string[] } | null {
  const candidates = listControlledDiffCandidates(workspacePath);
  const parts: string[] = [];
  const sourceNames: string[] = [];

  for (const candidate of candidates) {
    const content = readFileSync(candidate.path, "utf8");
    if (content.trim().length === 0) {
      continue;
    }
    sourceNames.push(candidate.name);
    parts.push(content.trimEnd());
  }

  if (parts.length === 0) {
    return null;
  }

  return {
    content: parts.join("\n\n") + "\n",
    sourceNames,
  };
}

function listControlledDiffCandidates(workspacePath: string): Array<{ path: string; name: string }> {
  const candidates: Array<{ path: string; name: string }> = [];
  const seen = new Set<string>();
  const addCandidate = (path: string, name: string) => {
    if (seen.has(path) || !existsSync(path)) {
      return;
    }
    const stat = statSync(path);
    if (!stat.isFile()) {
      return;
    }
    seen.add(path);
    candidates.push({ path, name });
  };

  const proofDir = join(workspacePath, ".auto-crop-proof");
  if (existsSync(proofDir) && statSync(proofDir).isDirectory()) {
    for (const entry of readdirSync(proofDir).sort()) {
      if (entry.endsWith(".diff")) {
        addCandidate(resolvePathInsideWorkspace(workspacePath, join(".auto-crop-proof", entry)), entry);
      }
    }
  }

  for (const entry of readdirSync(workspacePath).sort()) {
    if (entry.endsWith(".diff") || entry.endsWith(".patch")) {
      addCandidate(resolvePathInsideWorkspace(workspacePath, entry), entry);
    }
  }

  return candidates;
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

function isCopyableLocalArtifact(uri: string): boolean {
  if (/^https?:\/\//i.test(uri)) {
    return false;
  }

  return true;
}

function resolveCopyableArtifactPath(workspacePath: string, uri: string): string | null {
  try {
    return resolvePathInsideWorkspace(workspacePath, uri);
  } catch {
    return null;
  }
}

function sanitizeArtifactName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
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
