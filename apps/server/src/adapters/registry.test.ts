import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { noToolGrant, type AgentCapabilityGrant } from "../policies/capabilityGrant";
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

const researchRequest: AgentRunRequest = {
  ...request,
  grant: {
    granted: ["workspace_read", "workspace_write", "web_research"],
    withheld: [],
    id: "workspace_read+workspace_write+web_research",
  },
};

const createdDirs: string[] = [];

afterEach(() => {
  delete process.env.AUTO_CROP_AGENT_TIMEOUT_MS;
  delete process.env.AUTO_CROP_CODEX_MODEL;
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
    expect(createCodexAdapter().commandPreview(researchRequest)).toEqual({
      command: "codex",
      args: [
        "exec",
        "-m",
        "gpt-5.5",
        "-C",
        "/tmp/workspace",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--ephemeral",
        "-c",
        "tools.web_search=true",
        "-c",
        "sandbox_workspace_write.network_access=false",
        "Create a landing page",
      ],
    });
    expect(createClaudeCodeAdapter().commandPreview(researchRequest)).toEqual({
      command: "claude",
      args: [
        "-p",
        "--restricted",
        "--strict-mcp-config",
        "--permission-prompts",
        "none",
        "--tools",
        "Read,Glob,Grep,Write,Edit,WebSearch,WebFetch",
        "--allowedTools",
        "Read,Glob,Grep,Write,Edit,WebSearch,WebFetch",
        "--permission-mode",
        "acceptEdits",
        "--no-session-persistence",
        "--",
        "Create a landing page",
      ],
    });
  });

  /**
   * The reported failure, pinned. `--permission-mode acceptEdits` auto-approves file edits only, so a
   * run that had `WebSearch` in its toolset but not in `--allowedTools` met a permission prompt no
   * one could answer, called the denial a sandbox, and delivered estimates (ADR 0021).
   */
  it("pre-approves the web tools it grants, not just exposes them", () => {
    const args = createClaudeCodeAdapter().commandPreview(researchRequest).args;
    const allowed = args[args.indexOf("--allowedTools") + 1] ?? "";

    expect(allowed).toContain("WebSearch");
    expect(allowed).toContain("WebFetch");
  });

  /**
   * The reported failure, pinned. A verification task granted workspace read/write and web research —
   * but not `run_command` — was launched `--sandbox read-only`, could not create
   * `.auto-crop/business-artifact.json`, and the whole company blocked on a missing artifact.
   */
  it("lets a Codex run write its workspace whenever the grant carries workspace_write", () => {
    const sandboxFor = (granted: AgentCapabilityGrant["granted"]) => {
      const args = createCodexAdapter().commandPreview({ ...request, grant: { granted, withheld: [], id: granted.join("+") } }).args;
      return args[args.indexOf("--sandbox") + 1];
    };

    expect(sandboxFor(["workspace_read", "workspace_write"])).toBe("workspace-write");
    expect(sandboxFor(["workspace_read", "workspace_write", "web_research"])).toBe("workspace-write");
    expect(sandboxFor(["workspace_read", "workspace_write", "run_command"])).toBe("workspace-write");
    expect(sandboxFor(["workspace_read"])).toBe("read-only");
    expect(createCodexAdapter().commandPreview({ ...request, grant: noToolGrant }).args).toContain("read-only");
  });

  /**
   * Codex denies every socket in its workspace-write sandbox unless this config is on — verified
   * against the real CLI, where a run without it cannot bind 127.0.0.1 at all (ADR 0031).
   */
  it("opens Codex's local network only for a grant that carries it", () => {
    const networkFor = (granted: AgentCapabilityGrant["granted"]) => {
      const args = createCodexAdapter().commandPreview({ ...request, grant: { granted, withheld: [], id: granted.join("+") } }).args;
      return args[args.indexOf("sandbox_workspace_write.network_access=true") >= 0 ? args.indexOf("sandbox_workspace_write.network_access=true") : args.indexOf("sandbox_workspace_write.network_access=false")];
    };

    expect(networkFor(["workspace_read", "workspace_write", "run_command", "local_network"])).toBe("sandbox_workspace_write.network_access=true");
    expect(networkFor(["workspace_read", "workspace_write", "run_command"])).toBe("sandbox_workspace_write.network_access=false");
  });

  it("withholds the shell and the web from a grant that does not carry them", () => {
    const preview = createClaudeCodeAdapter().commandPreview({
      ...request,
      grant: { granted: ["workspace_read", "workspace_write"], withheld: [], id: "workspace_read+workspace_write" },
    });

    expect(preview.args[preview.args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep,Write,Edit");
    expect(preview.args).toContain("--restricted");
    expect(createCodexAdapter().commandPreview({ ...request, grant: undefined }).args).toContain(
      "tools.web_search=false",
    );
  });

  /**
   * A prompt asking for JSON is a request; this is a constraint. The two CLIs take it in opposite
   * shapes — Claude Code rejects a file path, Codex rejects inline JSON — so the runtime holds the
   * schema as an object and each adapter converts (ADR 0022).
   */
  it("passes an output contract to Claude Code inline", () => {
    const schema = { type: "object", properties: { purpose: { type: "string" } }, required: ["purpose"] };
    const args = createClaudeCodeAdapter().commandPreview({ ...request, outputSchema: schema }).args;

    expect(args[args.indexOf("--json-schema") + 1]).toBe(JSON.stringify(schema));
  });

  it("writes the contract to a file for Codex and removes it after the run", async () => {
    const schema = { type: "object", properties: { purpose: { type: "string" } }, required: ["purpose"] };
    let seenPath: string | undefined;
    let contentDuringRun: string | undefined;

    const adapter = createCliAgentAdapter({
      id: "fake-codex",
      name: "Fake Codex",
      capabilities: ["code"],
      buildCommand: ({ outputSchemaPath }) => {
        seenPath = outputSchemaPath;
        contentDuringRun = outputSchemaPath ? readFileSync(outputSchemaPath, "utf8") : undefined;
        return { command: "node", args: ["--version"] };
      },
    });

    await adapter.run({ ...request, workspacePath: process.cwd(), outputSchema: schema });

    expect(contentDuringRun).toBe(JSON.stringify(schema));
    expect(seenPath && existsSync(seenPath)).toBe(false);
  });

  it("omits the contract flag entirely when the run declares none", () => {
    expect(createClaudeCodeAdapter().commandPreview(request).args).not.toContain("--json-schema");
    expect(createCodexAdapter().commandPreview(request).args).not.toContain("--output-schema");
  });

  it("gives a no-tool grant an empty toolset and nothing to pre-approve", () => {
    const preview = createClaudeCodeAdapter().commandPreview({ ...request, grant: noToolGrant });

    expect(preview.args[preview.args.indexOf("--tools") + 1]).toBe("");
    expect(preview.args).not.toContain("--allowedTools");
  });

  it("allows the Codex model to be overridden without inheriting the CLI default", () => {
    expect(createCodexAdapter({ model: "gpt-5.6-sol" }).commandPreview(researchRequest)).toEqual({
      command: "codex",
      args: [
        "exec",
        "-m",
        "gpt-5.6-sol",
        "-C",
        "/tmp/workspace",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--ephemeral",
        "-c",
        "tools.web_search=true",
        "-c",
        "sandbox_workspace_write.network_access=false",
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
