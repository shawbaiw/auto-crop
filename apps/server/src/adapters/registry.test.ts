import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { noToolGrant, type AgentCapabilityGrant } from "../policies/capabilityGrant";
import {
  buildClaudeCodeCommand,
  buildCodexCommand,
  createClaudeCodeAdapter,
  createCliAgentAdapter,
  createCodexAdapter,
  interpolateCommandTemplate,
  isQuotaExhaustedOutput,
  runtimeActionMcpServer,
  type CommandValues,
} from "./cliAgent";
import { createMockAgentAdapter } from "./mockAgent";
import { createAgentRegistry, resolveLaunchableAdapter } from "./registry";
import type { AdapterContractCapability, AgentRunRequest } from "./types";

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
  --mcp-config <file>                   MCP server configuration file
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
    // The sandbox follows `workspace_write`, not the shell: Codex's sandbox governs writes, and a
    // read-only run still has a shell. Keying it on `run_command` launched every write-without-shell
    // grant read-only, where it could not write the artifact it had to deliver (ADR 0021).
    expect(workspaceOnly[workspaceOnly.indexOf("--sandbox") + 1]).toBe("workspace-write");
    expect(withShell[withShell.indexOf("--sandbox") + 1]).toBe("workspace-write");
    expect((await adapter.commandPreview({ ...request, grant: { granted: ["workspace_read"], withheld: [], id: "read" } })).args[
      (await adapter.commandPreview({ ...request, grant: { granted: ["workspace_read"], withheld: [], id: "read" } })).args.indexOf("--sandbox") + 1
    ]).toBe("read-only");
  });

  /**
   * Codex denies every socket in its workspace-write sandbox unless this config is on — verified
   * against the real CLI, where a run without it cannot bind 127.0.0.1 at all (ADR 0031).
   */
  it("opens Codex's local network only for a grant that carries it", async () => {
    const adapter = codexWith(CODEX_EXEC_HELP);
    const networkFor = async (granted: AgentCapabilityGrant["granted"]) =>
      (await adapter.commandPreview({ ...request, grant: { granted, withheld: [], id: granted.join("+") } })).args;

    expect(await networkFor(["workspace_read", "workspace_write", "run_command", "local_network"])).toContain(
      "sandbox_workspace_write.network_access=true",
    );
    expect(await networkFor(["workspace_read", "workspace_write", "run_command"])).toContain(
      "sandbox_workspace_write.network_access=false",
    );
  });

  /**
   * Both CLIs report an exhausted account by printing it and exiting non-zero — no exit code, no
   * structured field. Recording that as `agent_failed` blames the agent for a wait (ADR 0032).
   */
  it("reads an exhausted account as its own failure, not as the agent failing", () => {
    expect(isQuotaExhaustedOutput("You've hit your session limit · resets 7:10pm (Asia/Shanghai)")).toBe(true);
    expect(isQuotaExhaustedOutput("Error: usage limit reached for this account")).toBe(true);
    expect(isQuotaExhaustedOutput("quota exceeded")).toBe(true);
    expect(isQuotaExhaustedOutput("TypeError: cannot read property of undefined")).toBe(false);
    expect(isQuotaExhaustedOutput("the report describes a session limit for free users")).toBe(true);
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

  it("declares structured execution briefs only for Codex and artifact envelopes for both CLIs", async () => {
    expect(codexWith(CODEX_EXEC_HELP).contractCapabilities).toEqual(["structured_execution_brief", "artifact_envelope"]);
    expect(claudeWith(CLAUDE_HELP).contractCapabilities ?? []).not.toContain("structured_execution_brief");
    await expect(claudeWith(CLAUDE_HELP).resolveContractCapabilities?.()).resolves.toContain("artifact_envelope");
    await expect(claudeWith(withoutFlag(CLAUDE_HELP, "--mcp-config")).resolveContractCapabilities?.()).resolves.not.toContain("artifact_envelope");
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

  const actionRequest: AgentRunRequest = {
    ...request,
    workspacePath: process.cwd(),
    runtimeActions: {
      submitArtifactEnvelope: () => ({ ok: true }),
      mcp: {
        candidateDir: "/tmp/auto-crop-runtime-actions",
        companyId: "company_1",
        taskId: "task_1",
        runId: "run_1",
        locale: "en",
        requireExecutionDetails: true,
        proofSchemaId: "product-brief",
        acceptedProofTypes: ["file"],
      },
    },
  };

  /** Captures what a builder is handed during `run()`, without spawning the real CLI. */
  async function runtimeActionMcpSeenBy(contractCapabilities: AdapterContractCapability[]) {
    let seen: CommandValues["runtimeActionMcp"];
    let configDuringRun: unknown;
    const adapter = createCliAgentAdapter({
      id: "fake-agent",
      name: "Fake Agent",
      capabilities: ["code"],
      contractCapabilities,
      buildCommand: ({ runtimeActionMcp }) => {
        seen = runtimeActionMcp;
        configDuringRun = runtimeActionMcp ? JSON.parse(readFileSync(runtimeActionMcp.configPath, "utf8")) : undefined;
        return { command: "node", args: ["--version"] };
      },
    });
    await adapter.run(actionRequest);
    return { seen, configDuringRun };
  }

  it("writes an isolated runtime action MCP config for action-capable CLI runs", async () => {
    const { seen, configDuringRun } = await runtimeActionMcpSeenBy(["artifact_envelope"]);

    expect(configDuringRun).toMatchObject({
      mcpServers: {
        "auto-crop-runtime-actions": {
          command: process.execPath,
          env: {
            AUTO_CROP_RUNTIME_ACTION_DIR: "/tmp/auto-crop-runtime-actions",
            AUTO_CROP_RUNTIME_ACTION_COMPANY_ID: "company_1",
            AUTO_CROP_RUNTIME_ACTION_TASK_ID: "task_1",
            AUTO_CROP_RUNTIME_ACTION_RUN_ID: "run_1",
          },
        },
      },
    });
    expect(seen && existsSync(seen.configPath)).toBe(false);
  });

  it("hands no action server to an adapter that does not declare artifact_envelope", async () => {
    expect((await runtimeActionMcpSeenBy([])).seen).toBeUndefined();
  });

  /**
   * The CLI starts the server in the task workspace. A bare `--import tsx` resolved there, found no
   * `node_modules`, and the delivery tool never existed — so the loader is an absolute URL.
   */
  it("launches the action server with a loader that resolves outside the repository", () => {
    const server = runtimeActionMcpServer(actionRequest.runtimeActions!.mcp!);

    expect(server.args[0]).toBe("--import");
    expect(server.args[1]).toMatch(/^file:\/\//);
    expect(existsSync(new URL(server.args[1]!))).toBe(true);
  });

  it("pre-approves the delivery tool for Claude Code so a no-prompt run can call it", async () => {
    const runtimeActionMcp = { server: runtimeActionMcpServer(actionRequest.runtimeActions!.mcp!), configPath: "/tmp/mcp.json" };
    const launchSupport = (await claudeWith(CLAUDE_HELP).launchPlan!()).support;
    const { args } = buildClaudeCodeCommand({
      prompt: "p", workspace: "/tmp/workspace", promptPath: "", grant: workspaceGrant!, runtimeActionMcp, launchSupport,
    });

    expect(args[args.indexOf("--mcp-config") + 1]).toBe("/tmp/mcp.json");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(
      "Read,Glob,Grep,Write,Edit,mcp__auto-crop-runtime-actions__submit_artifact_envelope",
    );
    // Built-ins and MCP tools are separate lists: the delivery tool is allowed, not made a built-in.
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep,Write,Edit");
  });

  /**
   * `--ignore-user-config` leaves Codex no config file to name the server in, and `codex exec` runs
   * with approvals off — which cancels any MCP call that would ask. Both were observed on codex 0.147.
   */
  it("gives Codex the action server as -c overrides with its tools pre-approved", async () => {
    const server = runtimeActionMcpServer(actionRequest.runtimeActions!.mcp!);
    const launchSupport = (await codexWith(CODEX_EXEC_HELP).launchPlan!()).support;
    const { args } = buildCodexCommand("gpt-5.5", {
      prompt: "p", workspace: "/tmp/workspace", promptPath: "", grant: workspaceGrant!,
      runtimeActionMcp: { server, configPath: "/tmp/mcp.json" }, launchSupport,
    });
    const overrides = args.filter((_, index) => args[index - 1] === "-c");

    expect(overrides).toEqual(expect.arrayContaining([
      `mcp_servers.auto-crop-runtime-actions.command=${JSON.stringify(process.execPath)}`,
      `mcp_servers.auto-crop-runtime-actions.args=[${server.args.map((arg) => JSON.stringify(arg)).join(",")}]`,
      'mcp_servers.auto-crop-runtime-actions.env={AUTO_CROP_RUNTIME_ACTION_DIR="/tmp/auto-crop-runtime-actions",AUTO_CROP_RUNTIME_ACTION_COMPANY_ID="company_1",AUTO_CROP_RUNTIME_ACTION_TASK_ID="task_1",AUTO_CROP_RUNTIME_ACTION_RUN_ID="run_1",AUTO_CROP_RUNTIME_ACTION_LOCALE="en",AUTO_CROP_RUNTIME_ACTION_REQUIRE_EXECUTION_DETAILS="true",AUTO_CROP_RUNTIME_ACTION_PROOF_SCHEMA_ID="product-brief",AUTO_CROP_RUNTIME_ACTION_ACCEPTED_PROOF_TYPES="file"}',
      'mcp_servers.auto-crop-runtime-actions.default_tools_approval_mode="approve"',
    ]));
    expect(args.at(-1)).toBe("p");
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

  /**
   * Stopping a run, against real processes (execution-health P2b).
   *
   * These spawn node and signal it, because the defect being fixed only exists at that level: the
   * runtime used to send SIGTERM and resolve in the same tick, reporting a process as finished while
   * it was still running — and still writing to the workspace the next run was about to use.
   */
  describe("stopping a run", () => {
    const stoppableAdapter = () =>
      createCliAgentAdapter({
        id: "custom",
        name: "Custom Agent",
        capabilities: ["code"],
        commandTemplate: "node {promptPath}",
      });

    it.skipIf(process.platform === "win32")("does not confirm a natural exit while an in-group descendant still exists", async () => {
      const workspacePath = createWorkspaceWithScript(`
        import { spawn } from "node:child_process";
        const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], { stdio: "ignore" });
        child.unref();
        process.exit(1);
      `);
      const result = await stoppableAdapter().run({ ...request, workspacePath,
        promptPath: join(workspacePath, "agent-script.mjs"), timeoutMs: 5000 });
      expect(result.failureReason).toBe("agent_failed");
      expect(result.terminationConfirmed).toBeUndefined();
      await new Promise(resolve => setTimeout(resolve, 1100));
    });

    it("waits for the process to exit before reporting the stop, and confirms it", async () => {
      // Runs for a long time and exits promptly when asked.
      const workspacePath = createWorkspaceWithScript("setInterval(() => {}, 1000);");
      const stopper = new AbortController();
      const started = Date.now();

      const run = stoppableAdapter().run({
        ...request,
        promptPath: join(workspacePath, "agent-script.mjs"),
        workspacePath,
        timeoutMs: 60_000,
        signal: stopper.signal,
      });
      setTimeout(() => stopper.abort(), 100);
      const result = await run;

      expect(result.status).toBe("failed");
      expect(result.failureReason).toBe("cancelled");
      // It was seen to exit, not merely signalled.
      expect(result.terminationConfirmed).toBe(true);
      expect(result.stderr).toContain("stopped by the runtime");
      // And it did not sit through the full 60s budget waiting for one.
      expect(Date.now() - started).toBeLessThan(20_000);
    }, 30_000);

    it("escalates to a kill when the process ignores the polite signal", async () => {
      // Refuses SIGTERM outright; only SIGKILL will end it.
      const workspacePath = createWorkspaceWithScript(
        "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
      );
      const stopper = new AbortController();

      const run = stoppableAdapter().run({
        ...request,
        promptPath: join(workspacePath, "agent-script.mjs"),
        workspacePath,
        timeoutMs: 60_000,
        signal: stopper.signal,
        graceMs: 300,
        confirmMs: 2_000,
      });
      setTimeout(() => stopper.abort(), 100);
      const result = await run;

      expect(result.failureReason).toBe("cancelled");
      // Ignoring the request does not make a process unstoppable, and the runtime still knows it went.
      expect(result.terminationConfirmed).toBe(true);
    }, 30_000);

    it("takes the processes the agent started down with it", async () => {
      // An agent CLI spawns compilers, servers and test runners. Signalling only the process we hold
      // leaves those behind, still writing to the workspace this task is about to be retried in.
      const pidPath = join(mkdtempSync(join(tmpdir(), "auto-crop-grandchild-")), "grandchild.pid");
      createdDirs.push(dirname(pidPath));
      const workspacePath = createWorkspaceWithScript(`
        import { spawn } from "node:child_process";
        import { writeFileSync } from "node:fs";
        const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        writeFileSync(${JSON.stringify(pidPath)}, String(grandchild.pid), "utf8");
        setInterval(() => {}, 1000);
      `);
      const stopper = new AbortController();

      const run = stoppableAdapter().run({
        ...request,
        promptPath: join(workspacePath, "agent-script.mjs"),
        workspacePath,
        timeoutMs: 60_000,
        signal: stopper.signal,
        graceMs: 500,
        confirmMs: 2_000,
      });
      // Give the grandchild time to exist and record itself.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const grandchildPid = Number(readFileSync(pidPath, "utf8"));
      expect(isAlive(grandchildPid)).toBe(true);

      stopper.abort();
      await run;
      // Signal 0 only checks existence. Give the kernel a moment to reap the group.
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(isAlive(grandchildPid)).toBe(false);
    }, 30_000);
  });

});

/** Whether a pid still exists. Signal 0 checks for the process without touching it. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function createWorkspaceWithScript(script: string): string {
  const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-cli-agent-"));
  createdDirs.push(workspacePath);
  writeFileSync(join(workspacePath, "agent-script.mjs"), script, "utf8");
  return workspacePath;
}
