import { describe, expect, it } from "vitest";
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

    const result = await adapter.run(request);

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
});
