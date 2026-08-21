import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProofSchema, Task } from "@auto-crop/core";
import { captureProofs, createHandoffPackage, createProofCollector, getHandoffPackageManifestPath } from "./proof";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("captureProofs", () => {
  it("captures file proof from declared workspace paths", () => {
    const { task, workspacePath } = createFixture("file-proof", ["file"]);
    const filePath = join(workspacePath, "brief.md");
    writeFileSync(filePath, "# Product Brief\n", "utf8");

    const proof = captureProofs({
      task,
      proofSchema: { id: "file-proof", description: "file proof", acceptedTypes: ["file"] },
      workspacePath,
      logPath: join(workspacePath, "agent.log"),
      stdout: "",
      stderr: "",
      declaredFiles: ["brief.md"],
      createId: createSequentialIdFactory(),
    });

    expect(proof).toEqual([
      {
        id: "proof_1",
        taskId: "task_1",
        type: "file",
        uri: filePath,
        summary: "File proof: brief.md",
        verifiedAt: null,
      },
    ]);
  });

  it("captures diff proof from git worktree changes", () => {
    const { task, workspacePath } = createFixture("repo-diff", ["diff"]);

    const proof = captureProofs({
      task,
      proofSchema: { id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] },
      workspacePath,
      logPath: join(workspacePath, "agent.log"),
      stdout: "",
      stderr: "",
      diffText: "diff --git a/index.html b/index.html",
      createId: createSequentialIdFactory(),
    });

    expect(proof[0]).toMatchObject({
      id: "proof_1",
      taskId: "task_1",
      type: "diff",
      summary: "Diff proof captured.",
    });
    expect(existsSync(proof[0]?.uri ?? "")).toBe(true);
  });

  it("captures command output proof from log excerpts", () => {
    const { task, workspacePath } = createFixture("test-output", ["command_output", "test_result"]);
    const logPath = join(workspacePath, "agent.log");
    writeFileSync(logPath, "pnpm test\n42 passed\n", "utf8");

    const proof = captureProofs({
      task,
      proofSchema: {
        id: "test-output",
        description: "command output proof",
        acceptedTypes: ["command_output", "test_result"],
      },
      workspacePath,
      logPath,
      stdout: "42 passed",
      stderr: "",
      createId: createSequentialIdFactory(),
    });

    expect(proof).toContainEqual({
      id: "proof_1",
      taskId: "task_1",
      type: "command_output",
      uri: logPath,
      summary: "Command output proof captured.",
      verifiedAt: null,
    });
  });

  it("captures local and deployment URL proof", () => {
    const { task, workspacePath } = createFixture("url-proof", ["url", "deployment"]);

    const proof = captureProofs({
      task,
      proofSchema: { id: "url-proof", description: "url proof", acceptedTypes: ["url", "deployment"] },
      workspacePath,
      logPath: join(workspacePath, "agent.log"),
      stdout: "",
      stderr: "",
      urls: ["http://localhost:5173"],
      deploymentUrls: ["https://pricing.example.com"],
      createId: createSequentialIdFactory(),
    });

    expect(proof.map((item) => item.type)).toEqual(["url", "deployment"]);
  });

  it("captures screenshot proof from declared workspace paths", () => {
    const { task, workspacePath } = createFixture("screenshot-proof", ["screenshot"]);
    const screenshotPath = join(workspacePath, "screen.png");
    writeFileSync(screenshotPath, "not really a png", "utf8");

    const proof = captureProofs({
      task,
      proofSchema: {
        id: "screenshot-proof",
        description: "screenshot proof",
        acceptedTypes: ["screenshot"],
      },
      workspacePath,
      logPath: join(workspacePath, "agent.log"),
      stdout: "",
      stderr: "",
      screenshots: ["screen.png"],
      createId: createSequentialIdFactory(),
    });

    expect(proof[0]).toMatchObject({
      type: "screenshot",
      uri: screenshotPath,
      summary: "Screenshot proof: screen.png",
    });
  });

  it("rejects proof that does not match the task proof schema", () => {
    const { task, workspacePath } = createFixture("file-proof", ["file"]);
    writeFileSync(join(workspacePath, "brief.md"), "# Product Brief\n", "utf8");

    expect(() =>
      captureProofs({
        task,
        proofSchema: { id: "wrong-proof", description: "wrong proof", acceptedTypes: ["file"] },
        workspacePath,
        logPath: join(workspacePath, "agent.log"),
        stdout: "",
        stderr: "",
        declaredFiles: ["brief.md"],
        createId: createSequentialIdFactory(),
      }),
    ).toThrow(/does not match task proof schema/i);
  });

  it("rejects declared file paths outside the workspace", () => {
    const { task, workspacePath } = createFixture("file-proof", ["file"]);

    expect(() =>
      captureProofs({
        task,
        proofSchema: { id: "file-proof", description: "file proof", acceptedTypes: ["file"] },
        workspacePath,
        logPath: join(workspacePath, "agent.log"),
        stdout: "",
        stderr: "",
        declaredFiles: ["../secret.txt"],
        createId: createSequentialIdFactory(),
      }),
    ).toThrow(/outside workspace/i);
  });
});

describe("createProofCollector", () => {
  it("creates a scheduler proofCollector for configured proof schemas", () => {
    const { task, workspacePath } = createFixture("test-output", ["command_output"]);
    const logPath = join(workspacePath, "agent.log");
    writeFileSync(logPath, "42 passed\n", "utf8");
    const collect = createProofCollector({
      proofSchemas: [
        {
          id: "test-output",
          description: "command output proof",
          acceptedTypes: ["command_output"],
        },
      ],
      createId: createSequentialIdFactory(),
    });

    const proof = collect({
      task: { ...task, workspacePath },
      stdout: "42 passed",
      stderr: "",
      logPath,
    });

    expect(proof).toHaveLength(1);
    expect(proof[0]?.type).toBe("command_output");
  });

  it("captures local URL proof from successful stdout", () => {
    const { task, workspacePath } = createFixture("deployment-url", ["deployment", "url"]);
    const collect = createProofCollector({
      proofSchemas: [
        {
          id: "deployment-url",
          description: "deployment proof",
          acceptedTypes: ["deployment", "url"],
        },
      ],
      createId: createSequentialIdFactory(),
    });

    const proof = collect({
      task: { ...task, workspacePath },
      stdout: "Local runnable URL: http://127.0.0.1:5175/",
      stderr: "",
      logPath: join(workspacePath, "agent.log"),
    });

    expect(proof).toEqual([
      {
        id: "proof_1",
        taskId: "task_1",
        type: "url",
        uri: "http://127.0.0.1:5175/",
        summary: "URL proof: http://127.0.0.1:5175/",
        verifiedAt: null,
      },
    ]);
  });

  it("writes successful stdout to stable markdown file proof for text schemas", () => {
    const { task, workspacePath } = createFixture("product-brief", ["file"]);
    const logPath = join(workspacePath, "agent.log");
    const collect = createProofCollector({
      proofSchemas: [
        {
          id: "product-brief",
          description: "product brief proof",
          acceptedTypes: ["file"],
        },
      ],
      createId: createSequentialIdFactory(),
    });

    const proof = collect({
      task: { ...task, workspacePath },
      stdout: "# Product Brief\n\nShip the narrow wedge.",
      stderr: "",
      logPath,
    });
    const proofPath = join(workspacePath, "product-brief.md");

    expect(readProofFile(proofPath)).toContain("Ship the narrow wedge.");
    expect(proof).toEqual([
      {
        id: "proof_1",
        taskId: "task_1",
        type: "file",
        uri: proofPath,
        summary: "File proof: product-brief.md",
        verifiedAt: null,
      },
    ]);
  });

  it("captures a playable prototype entry file without turning stdout into file proof", () => {
    const { task, workspacePath } = createFixture("landing-page-file", ["file"]);
    const entryPath = join(workspacePath, "app", "page.tsx");
    const collect = createProofCollector({
      proofSchemas: [
        {
          id: "landing-page-file",
          description: "prototype file proof",
          acceptedTypes: ["file"],
        },
      ],
      createId: createSequentialIdFactory(),
    });
    mkdirSync(join(workspacePath, "app"), { recursive: true });
    writeFileSync(entryPath, "export default function Page() { return null; }\n", "utf8");

    const proof = collect({
      task: { ...task, workspacePath },
      stdout: "Implemented a prototype.",
      stderr: "",
      logPath: join(workspacePath, "agent.log"),
    });

    expect(existsSync(join(workspacePath, "task-output.md"))).toBe(false);
    expect(proof).toEqual([
      {
        id: "proof_1",
        taskId: "task_1",
        type: "file",
        uri: entryPath,
        summary: "File proof: app/page.tsx",
        verifiedAt: null,
      },
    ]);
  });
});

describe("createHandoffPackage", () => {
  it("packages file proof into a manifest and artifacts directory for downstream handoff", () => {
    const { task, workspacePath } = createFixture("product-brief", ["file"]);
    const proofPath = join(workspacePath, "product-brief.md");
    const logPath = join(workspacePath, "agent.log");
    writeFileSync(proofPath, "# Product Brief\n\nShip the wedge.\n", "utf8");
    writeFileSync(logPath, "agent log\n", "utf8");

    const handoffPackage = createHandoffPackage({
      task: { ...task, workspacePath },
      proofs: [
        {
          id: "proof_1",
          taskId: task.id,
          type: "file",
          uri: proofPath,
          summary: "File proof: product-brief.md",
          verifiedAt: null,
        },
      ],
      workspacePath,
      logPath,
    });

    expect(handoffPackage?.manifestPath).toBe(join(workspacePath, ".auto-crop-handoff", "package.json"));
    expect(getHandoffPackageManifestPath({ ...task, workspacePath })).toBe(handoffPackage?.manifestPath);
    const manifest = JSON.parse(readFileSync(handoffPackage?.manifestPath ?? "", "utf8")) as {
      artifacts: Array<{ packagePath: string; proofId: string }>;
      proofs: Array<{ id: string; uri: string }>;
      task: { id: string; title: string; proofSchemaId: string };
    };
    expect(manifest.task).toEqual({
      id: "task_1",
      title: "Capture proof",
      proofSchemaId: "product-brief",
    });
    expect(manifest.proofs).toEqual([
      {
        id: "proof_1",
        type: "file",
        uri: proofPath,
        summary: "File proof: product-brief.md",
      },
    ]);
    expect(manifest.artifacts).toHaveLength(1);
    expect(manifest.artifacts[0]?.proofId).toBe("proof_1");
    expect(readProofFile(manifest.artifacts[0]?.packagePath ?? "")).toContain("Ship the wedge.");
  });

  it("records URL proof in the manifest without copying remote artifacts", () => {
    const { task, workspacePath } = createFixture("deployment-url", ["deployment"]);

    const handoffPackage = createHandoffPackage({
      task: { ...task, workspacePath },
      proofs: [
        {
          id: "proof_1",
          taskId: task.id,
          type: "deployment",
          uri: "https://example.com",
          summary: "Deployment proof: https://example.com",
          verifiedAt: null,
        },
      ],
      workspacePath,
      logPath: join(workspacePath, "agent.log"),
    });

    const manifest = JSON.parse(readFileSync(handoffPackage?.manifestPath ?? "", "utf8")) as {
      artifacts: unknown[];
      proofs: Array<{ uri: string }>;
    };
    expect(manifest.proofs).toEqual([
      {
        id: "proof_1",
        type: "deployment",
        uri: "https://example.com",
        summary: "Deployment proof: https://example.com",
      },
    ]);
    expect(manifest.artifacts).toEqual([]);
  });

  it("records local proof outside the workspace without copying it into the package", () => {
    const { task, workspacePath } = createFixture("test-output", ["command_output"]);
    const outsideDir = mkdtempSync(join(tmpdir(), "auto-crop-log-"));
    createdDirs.push(outsideDir);
    const logPath = join(outsideDir, "agent.log");
    writeFileSync(logPath, "42 passed\n", "utf8");

    const handoffPackage = createHandoffPackage({
      task: { ...task, workspacePath },
      proofs: [
        {
          id: "proof_1",
          taskId: task.id,
          type: "command_output",
          uri: logPath,
          summary: "Command output proof captured.",
          verifiedAt: null,
        },
      ],
      workspacePath,
      logPath,
    });

    const manifest = JSON.parse(readFileSync(handoffPackage?.manifestPath ?? "", "utf8")) as {
      artifacts: unknown[];
      proofs: Array<{ uri: string }>;
    };
    expect(manifest.proofs).toEqual([
      {
        id: "proof_1",
        type: "command_output",
        uri: logPath,
        summary: "Command output proof captured.",
      },
    ]);
    expect(manifest.artifacts).toEqual([]);
  });
});

function createFixture(proofSchemaId: string, acceptedTypes: ProofSchema["acceptedTypes"]) {
  const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-proof-"));
  createdDirs.push(workspacePath);

  return {
    workspacePath,
    task: {
      id: "task_1",
      companyId: "company_1",
      departmentId: "department_1",
      keyResultId: "key_result_1",
      title: "Capture proof",
      description: "Capture proof.",
      assigneeAgentId: "mock-worker",
      requiredCapabilities: ["code"],
      proofSchemaId,
      workspacePath,
      status: "running",
      riskLevel: "low",
      position: 0,
    } satisfies Task,
    proofSchema: {
      id: proofSchemaId,
      description: "test proof schema",
      acceptedTypes,
    } satisfies ProofSchema,
  };
}

function createSequentialIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

function readProofFile(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
