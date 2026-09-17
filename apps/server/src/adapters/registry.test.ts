import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { noToolGrant } from "../policies/capabilityGrant";
import { createClaudeCodeAdapter, createCliAgentAdapter, createCodexAdapter, interpolateCommandTemplate } from "./cliAgent";
import { createMockAgentAdapter } from "./mockAgent";
import { createAgentRegistry, resolveLaunchableAdapter } from "./registry";
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

const workspaceGrant: AgentRunRequest["grant"] = {
  granted: ["workspace_read", "workspace_write"],
  withheld: [],
  id: "workspace_read+workspace_write",
};

/** Option declarations as Claude Code 2.1 prints them, trimmed to the flags the adapter reads. */
const CLAUDE_HELP = `Usage: claude [options] [command] [prompt]

Options:
  --allowedTools, --allowed-tools <tools...>
                                        Comma or space-separated list of tool names to allow
  --json-schema <schema>                JSON Schema for structured output
  --no-session-persistence              Disable session persistence
  -p, --print                           Print response and exit
  --permission-mode <mode>              Permission mode to use for the session
  --permission-prompts <target>         Who answers permission prompts
  --restricted                          Restricted mode: removes the built-in shell tools unless
                                        --tools names them, and ignores user settings; add
                                        --strict-mcp-config to skip host MCP servers
  --strict-mcp-config                   Only use MCP servers from --mcp-config
  --tools <tools...>                    Specify the list of available tools
`;

/** Option declarations as `codex exec --help` (0.147) prints them. */
const CODEX_EXEC_HELP = `Run Codex non-interactively

Options:
  -c, --config <key=value>
          Override a configuration value. Examples: - \`-c model="o3"\`
      --ephemeral
          Run without persisting session files
      --ignore-user-config
          Do not load $CODEX_HOME/config.toml
      --ignore-rules
          Do not load user or project execpolicy .rules files
  -m, --model <MODEL>
          Model the agent should use
      --output-schema <FILE>
          Path to a JSON Schema file
  -s, --sandbox <SANDBOX_MODE>
          Select the sandbox policy
  -C, --cd <DIR>
          Tell the agent to use the specified directory as its working root
      --skip-git-repo-check
          Allow running Codex outside a Git repository
`;

/** Help text with one option's declaration removed; descriptions that mention it are kept. */
function withoutFlag(help: string, flag: string): string {
  return help
    .split("\n")
    .filter((line) => !new RegExp(`^ {0,6}(?:-{1,2}[\\w-]+,\\s*)*${flag}\\b`).test(line))
    .join("\n");
}

function claudeWith(help: string) {
  return createClaudeCodeAdapter({ readHelp: async () => help });
}

function codexWith(help: string) {
  return createCodexAdapter({ readHelp: async () => help });
}

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

  it("skips an adapter whose executable exists but whose launch support is unavailable", async () => {
    const registry = createAgentRegistry([
      createMockAgentAdapter({ id: "old-claude", name: "Old Claude", capabilities: ["code"], launchSupport: unavailableSupport }),
      createMockAgentAdapter({ id: "codex", name: "Codex", capabilities: ["code"] }),
    ]);

    await expect(registry.selectByCapabilities(["code"])).resolves.toMatchObject({ id: "codex" });
    await expect(resolveLaunchableAdapter(registry.list())).resolves.toMatchObject({
      launchable: true,
      adapter: { id: "codex" },
    });
  });

  it("keeps a compatible adapter selectable and carries its warnings", async () => {
    const compatible = createMockAgentAdapter({
      id: "claude-code",
      name: "Claude Code",
      capabilities: ["code"],
      launchSupport: {
        isolationLevel: "compatible",
        supportedFlags: [],
        missingFlags: ["--restricted"],
        warnings: ["Claude Code does not support --restricted; using compatibility launch isolation."],
      },
    });
    const registry = createAgentRegistry([compatible]);

    await expect(registry.selectByCapabilities(["code"])).resolves.toBe(compatible);
    const resolution = await resolveLaunchableAdapter([compatible]);
    expect(resolution.launchable && resolution.support?.warnings).toEqual([
      "Claude Code does not support --restricted; using compatibility launch isolation.",
    ]);
  });

  it("reports every unavailable candidate when none can launch", async () => {
    const resolution = await resolveLaunchableAdapter([
      createMockAgentAdapter({ id: "old-claude", name: "Old Claude", capabilities: ["code"], launchSupport: unavailableSupport }),
    ]);

    expect(resolution).toMatchObject({ launchable: false, unavailable: [{ adapterId: "old-claude" }] });
  });
});

const unavailableSupport = {
  isolationLevel: "unavailable" as const,
  supportedFlags: [],
  missingFlags: ["--tools"],
  warnings: ["Old Claude does not support --tools."],
};

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

  /**
   * The installed CLI decides which flags exist. Every built-in launch below is built from injected
   * help text, so no test depends on whichever CLI version the machine running it has.
   */
  it("launches Claude Code with --restricted when the installed CLI supports it", async () => {
    const adapter = claudeWith(CLAUDE_HELP);

    expect(await adapter.commandPreview(researchRequest)).toEqual({
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
    expect((await adapter.launchPlan?.())?.support).toMatchObject({ isolationLevel: "strong", warnings: [] });
    await expect(adapter.detect()).resolves.toBe(true);
  });

  /** The reported failure, pinned: this install used to fail every task with `unknown option '--restricted'`. */
  it("omits --restricted and reports compatible isolation when the installed CLI lacks it", async () => {
    const adapter = claudeWith(withoutFlag(CLAUDE_HELP, "--restricted"));
    const plan = await adapter.launchPlan?.();

    expect((await adapter.commandPreview(researchRequest)).args).not.toContain("--restricted");
    expect(plan?.support.isolationLevel).toBe("compatible");
    expect(plan?.support.missingFlags).toContain("--restricted");
    expect(plan?.support.warnings.join(" ")).toContain("does not support --restricted");
    await expect(adapter.detect()).resolves.toBe(true);
  });

  it("does not pass --permission-prompts to a CLI that does not declare it", async () => {
    const adapter = claudeWith(withoutFlag(CLAUDE_HELP, "--permission-prompts"));

    expect((await adapter.commandPreview(request)).args).not.toContain("--permission-prompts");
    expect((await adapter.launchPlan?.())?.support.isolationLevel).toBe("strong");
  });

  it("uses the spelling of --allowedTools the installed CLI declares", async () => {
    const help = CLAUDE_HELP.replace("--allowedTools, --allowed-tools", "--allowed-tools");
    const args = (await claudeWith(help).commandPreview(researchRequest)).args;

    expect(args).toContain("--allowed-tools");
    expect(args).not.toContain("--allowedTools");
  });

  it("marks Claude Code unavailable when it cannot express explicit tool grants", async () => {
    const adapter = claudeWith(withoutFlag(CLAUDE_HELP, "--tools"));

    expect((await adapter.launchPlan?.())?.support).toMatchObject({
      isolationLevel: "unavailable",
      missingFlags: ["--tools"],
    });
    await expect(adapter.detect()).resolves.toBe(false);
  });

  it("refuses to spawn a launch whose support is unavailable", async () => {
    const result = await claudeWith(withoutFlag(CLAUDE_HELP, "--strict-mcp-config")).run({
      ...request,
      workspacePath: process.cwd(),
    });

    expect(result.status).toBe("failed");
    expect(result.stderr).toContain("--strict-mcp-config");
  });

  it("marks an adapter unavailable when its help probe cannot run", async () => {
    const adapter = createClaudeCodeAdapter({ readHelp: async () => null });

    expect((await adapter.launchPlan?.())?.support.isolationLevel).toBe("unavailable");
    await expect(adapter.detect()).resolves.toBe(false);
  });

  /**
   * `--permission-mode acceptEdits` auto-approves file edits only, so a run that had `WebSearch` in
   * its toolset but not in `--allowedTools` met a permission prompt no one could answer, called the
   * denial a sandbox, and delivered estimates (ADR 0021).
   */
  it("pre-approves the web tools it grants, not just exposes them", async () => {
    const args = (await claudeWith(CLAUDE_HELP).commandPreview(researchRequest)).args;

    expect(args[args.indexOf("--tools") + 1]).toContain("WebSearch");
    expect(args[args.indexOf("--allowedTools") + 1]).toContain("WebSearch");
    expect(args[args.indexOf("--allowedTools") + 1]).toContain("WebFetch");
  });

  it("withholds the web from a grant that does not carry it", async () => {
    const args = (await claudeWith(CLAUDE_HELP).commandPreview({ ...request, grant: workspaceGrant })).args;

    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep,Write,Edit");
    expect(args.join(" ")).not.toContain("WebSearch");
    expect(args.join(" ")).not.toContain("WebFetch");
  });

  it("keeps the shell out of a research-only grant", async () => {
    const args = (await claudeWith(CLAUDE_HELP).commandPreview(researchRequest)).args;

    expect(args.join(" ")).not.toContain("Bash");
  });

  it("gives a no-tool grant an empty toolset and nothing to pre-approve", async () => {
    const args = (await claudeWith(CLAUDE_HELP).commandPreview({ ...request, grant: noToolGrant })).args;

    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).not.toContain("--allowedTools");
  });

  it("translates the launch policy into Codex flags", async () => {
    expect(await codexWith(CODEX_EXEC_HELP).commandPreview(researchRequest)).toEqual({
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
        "read-only",
        "--ephemeral",
        "-c",
        "tools.web_search=true",
        "Create a landing page",
      ],
    });
  });

  it("maps web research and the shell onto Codex's own switches", async () => {
    const adapter = codexWith(CODEX_EXEC_HELP);
    const research = (await adapter.commandPreview(researchRequest)).args;
    const workspaceOnly = (await adapter.commandPreview({ ...request, grant: undefined })).args;
    const withShell = (await adapter.commandPreview({
      ...request,
      grant: { granted: ["workspace_read", "workspace_write", "run_command"], withheld: [], id: "shell" },
    })).args;

    expect(research).toContain("tools.web_search=true");
    expect(workspaceOnly).toContain("tools.web_search=false");
    expect(workspaceOnly[workspaceOnly.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(withShell[withShell.indexOf("--sandbox") + 1]).toBe("workspace-write");
  });

  it("marks Codex unavailable when a required isolation flag is missing", async () => {
    const adapter = codexWith(withoutFlag(CODEX_EXEC_HELP, "--ignore-rules"));

    expect((await adapter.launchPlan?.())?.support).toMatchObject({
      isolationLevel: "unavailable",
      missingFlags: ["--ignore-rules"],
    });
    await expect(adapter.detect()).resolves.toBe(false);
  });

  it("never gives Codex a Claude-only flag, even from Claude-shaped help", async () => {
    const args = (await codexWith(`${CODEX_EXEC_HELP}\n${CLAUDE_HELP}`).commandPreview(researchRequest)).args;

    for (const claudeOnly of ["--restricted", "--strict-mcp-config", "--permission-prompts", "--tools", "--allowedTools"]) {
      expect(args).not.toContain(claudeOnly);
    }
  });

  /**
   * A prompt asking for JSON is a request; this is a constraint. The two CLIs take it in opposite
   * shapes — Claude Code rejects a file path, Codex rejects inline JSON — so the runtime holds the
   * schema as an object and each adapter converts (ADR 0022).
   */
  it("passes an output contract to Claude Code inline", async () => {
    const schema = { type: "object", properties: { purpose: { type: "string" } }, required: ["purpose"] };
    const args = (await claudeWith(CLAUDE_HELP).commandPreview({ ...request, outputSchema: schema })).args;

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

  it("omits the contract flag entirely when the run declares none", async () => {
    expect((await claudeWith(CLAUDE_HELP).commandPreview(request)).args).not.toContain("--json-schema");
    expect((await codexWith(CODEX_EXEC_HELP).commandPreview(request)).args).not.toContain("--output-schema");
  });

  it("allows the Codex model to be overridden without inheriting the CLI default", async () => {
    const args = (await createCodexAdapter({ model: "gpt-5.6-sol", readHelp: async () => CODEX_EXEC_HELP })
      .commandPreview(researchRequest)).args;

    expect(args.slice(0, 3)).toEqual(["exec", "-m", "gpt-5.6-sol"]);
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
