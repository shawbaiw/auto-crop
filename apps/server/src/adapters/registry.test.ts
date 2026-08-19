import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeCodeAdapter, createCliAgentAdapter, createCodexAdapter, interpolateCommandTemplate } from "./cliAgent";
import { createMockAgentAdapter } from "./mockAgent";
import { createAgentRegistry } from "./registry";
import type { AgentRunRequest } from "./types";

const request: AgentRunRequest = {
  taskId: "task_1",
  prompt: "Create a landing page",
  promptPath: "/tmp/prompt.md",
  workspacePath: "/tmp/workspace",
  metadata: {
    departmentName: "Engineering",
    proofSchemaId: "landing-page-proof",
  },
};

const createdDirs: string[] = [];

afterEach(() => {
  delete process.env.AUTO_CROP_AGENT_TIMEOUT_MS;
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("agent registry", () => {
  it("selects the first detected adapter that satisfies all required capabilities", async () => {
    const registry = createAgentRegistry([
      createMockAgentAdapter({
        id: "writer",
        name: "Writer",
        capabilities: ["writing"],
      }),
      createMockAgentAdapter({
        id: "codex",
        name: "Codex",
        capabilities: ["code", "frontend", "test"],
      }),
    ]);

    const adapter = await registry.selectByCapabilities(["code", "frontend"]);

    expect(adapter.id).toBe("codex");
  });

  it("throws when no detected adapter has every required capability", async () => {
    const registry = createAgentRegistry([
      createMockAgentAdapter({
        id: "writer",
        name: "Writer",
        capabilities: ["writing"],
      }),
    ]);

    await expect(registry.selectByCapabilities(["code"])).rejects.toThrow(/no agent adapter/i);
  });
});

describe("mock agent adapter", () => {
  it("returns a completed run result with stdout proof text", async () => {
    const adapter = createMockAgentAdapter({
      id: "mock-codex",
      name: "Mock Codex",
      capabilities: ["code"],
      output: "created file: index.html",
    });

    const result = await adapter.run({ ...request, workspacePath: process.cwd() });

    expect(result.status).toBe("complete");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("created file");
  });
});

describe("CLI command template adapter", () => {
  it("interpolates workspace and prompt path placeholders", () => {
    const command = interpolateCommandTemplate("codex --cwd {workspace} --prompt-file {promptPath}", {
      prompt: "Create a landing page",
      workspace: "/tmp/my workspace",
      promptPath: "/tmp/prompt.md",
    });

    expect(command).toEqual({
      command: "codex",
      args: ["--cwd", "/tmp/my workspace", "--prompt-file", "/tmp/prompt.md"],
    });
  });

  it("interpolates prompt placeholders as a single argument", () => {
    const command = interpolateCommandTemplate("codex exec -C {workspace} {prompt}", {
      prompt: "Create a file named smoke.txt",
      workspace: "/tmp/my workspace",
      promptPath: "/tmp/prompt.md",
    });

    expect(command).toEqual({
      command: "codex",
      args: ["exec", "-C", "/tmp/my workspace", "Create a file named smoke.txt"],
    });
  });

  it("uses current non-interactive command shapes for built-in local agents", () => {
    expect(createCodexAdapter().commandPreview(request)).toEqual({
      command: "codex",
      args: [
        "exec",
        "-C",
        "/tmp/workspace",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--ephemeral",
        "Create a landing page",
      ],
    });
    expect(createClaudeCodeAdapter().commandPreview(request)).toEqual({
      command: "claude",
      args: [
        "-p",
        "--permission-mode",
        "acceptEdits",
        "--no-session-persistence",
        "--",
        "Create a landing page",
      ],
    });
  });

  it("detects command-template agents from their binary", async () => {
    const adapter = createCliAgentAdapter({
      id: "custom",
      name: "Custom Agent",
      capabilities: ["code"],
      commandTemplate: "node --version",
    });

    await expect(adapter.detect()).resolves.toBe(true);
  });

  it("uses request timeout for CLI agent runs", async () => {
    const workspacePath = createWorkspaceWithScript("setTimeout(() => {}, 50);");
    const adapter = createCliAgentAdapter({
      id: "custom",
      name: "Custom Agent",
      capabilities: ["code"],
      commandTemplate: "node {promptPath}",
    });

    const result = await adapter.run({
      ...request,
      promptPath: join(workspacePath, "agent-script.mjs"),
      workspacePath,
      timeoutMs: 1,
    });

    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("timeout");
  });

  it("ignores AUTO_CROP_AGENT_TIMEOUT_MS because runtime resolves effective timeout", async () => {
    process.env.AUTO_CROP_AGENT_TIMEOUT_MS = "1000";
    const workspacePath = createWorkspaceWithScript("setTimeout(() => process.exit(0), 20);");
    const adapter = createCliAgentAdapter({
      id: "custom",
      name: "Custom Agent",
      capabilities: ["code"],
      commandTemplate: "node {promptPath}",
    });

    const result = await adapter.run({
      ...request,
      promptPath: join(workspacePath, "agent-script.mjs"),
      workspacePath,
      timeoutMs: 1,
    });

    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("timeout");
  });
});

function createWorkspaceWithScript(script: string): string {
  const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-cli-agent-"));
  createdDirs.push(workspacePath);
  writeFileSync(join(workspacePath, "agent-script.mjs"), script, "utf8");
  return workspacePath;
}
