import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProofSchema, Task } from "@auto-crop/core";
import { captureProofs, createClaudeCodeAdapter, createCodexAdapter } from "@auto-crop/server";

const requestedAgentId = process.env.AUTO_CROP_REAL_AGENT ?? "claude-code";
const adapter = requestedAgentId === "codex" ? createCodexAdapter() : createClaudeCodeAdapter();
const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-real-agent-smoke-"));
const logPath = join(workspacePath, "agent.log");
const prompt = [
  "Create a file named smoke.txt in the current workspace.",
  "The file must contain exactly this single line:",
  "auto-crop real agent smoke ok",
  "Do not edit any other file.",
].join("\n");

try {
  const detected = await adapter.detect();
  assert(detected, `${adapter.name} should be detected before running real-agent smoke.`);

  const result = await adapter.run({
    taskId: "task_real_agent_smoke",
    prompt,
    promptPath: "",
    workspacePath,
    metadata: {
      departmentName: "Engineering",
      proofSchemaId: "real-agent-smoke-proof",
    },
  });
  writeFileSync(logPath, [result.stdout, result.stderr].join("\n"), "utf8");

  assert(result.status === "complete", `${adapter.name} should complete. stderr: ${result.stderr}`);

  const smokeFile = join(workspacePath, "smoke.txt");
  assert(existsSync(smokeFile), "Real agent should create smoke.txt.");
  assert(
    readFileSync(smokeFile, "utf8").trim() === "auto-crop real agent smoke ok",
    "smoke.txt should contain the expected proof text.",
  );

  const task: Task = {
    id: "task_real_agent_smoke",
    companyId: "company_real_agent_smoke",
    departmentId: "department_engineering",
    objectiveId: null,
    keyResultId: null,
    title: "Run real agent smoke",
    description: prompt,
    assigneeAgentId: adapter.id,
    requiredCapabilities: ["code"],
    proofSchemaId: "real-agent-smoke-proof",
    workspacePath,
    status: "review",
    riskLevel: "low",
    position: 0,
  };
  const proofSchema: ProofSchema = {
    id: "real-agent-smoke-proof",
    description: "Real local agent creates a file in an isolated workspace.",
    acceptedTypes: ["file", "command_output"],
    required: true,
  };
  const proof = captureProofs({
    task,
    proofSchema,
    workspacePath,
    logPath,
    stdout: result.stdout,
    stderr: result.stderr,
    declaredFiles: ["smoke.txt"],
    createId: () => "proof_real_agent_smoke",
  });

  assert(proof.some((item) => item.type === "file"), "File proof should be captured.");

  console.log("Real agent smoke test passed.");
  console.log(`Agent: ${adapter.name}`);
  console.log(`Workspace: ${workspacePath}`);
  console.log(`Proof count: ${proof.length}`);
} finally {
  rmSync(workspacePath, { recursive: true, force: true });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
