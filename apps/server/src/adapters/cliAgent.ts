import { spawn } from "node:child_process";
import type { AgentCapabilityGrant, RuntimeCapability } from "../policies/capabilityGrant";
import type { AgentAdapter, AgentRunRequest, AgentRunResult, AgentSessionProbeResult } from "./types";

export type CommandValues = {
  prompt: string;
  workspace: string;
  promptPath: string;
  grant: AgentCapabilityGrant;
};

export type CliAgentOptions = {
  id: string;
  name: string;
  capabilities: string[];
  /** Grant-blind template, for generic adapters. Exactly one of this or `buildCommand` is required. */
  commandTemplate?: string;
  /** Grant-driven launch construction. Takes precedence over `commandTemplate` when both are given. */
  buildCommand?: (values: CommandValues) => InterpolatedCommand;
  /** Optional persistent-session availability check. See `docs/persistent-agent-sessions-plan.md` Task 7. */
  probeSession?: () => Promise<AgentSessionProbeResult>;
  timeoutMs?: number;
  log?: (line: string) => void;
};

export type InterpolatedCommand = {
  command: string;
  args: string[];
};

export type CliAgentAdapter = AgentAdapter & {
  commandPreview(request: AgentRunRequest): InterpolatedCommand;
};

const DEFAULT_CODEX_MODEL = "gpt-5.5";

export function createCliAgentAdapter(options: CliAgentOptions): CliAgentAdapter {
  const build = (values: CommandValues): InterpolatedCommand => {
    if (options.buildCommand) {
      return options.buildCommand(values);
    }
    if (!options.commandTemplate) {
      throw new Error(`Agent adapter ${options.id} needs a commandTemplate or a buildCommand.`);
    }
    return interpolateCommandTemplate(options.commandTemplate, values);
  };

  return {
    id: options.id,
    name: options.name,
    capabilities: options.capabilities,
    ...(options.probeSession ? { session: { probe: options.probeSession, getOrStart: async () => null } } : {}),

    async detect(): Promise<boolean> {
      const { command } = build({
        prompt: "",
        workspace: ".",
        promptPath: "",
        grant: WORKSPACE_ONLY_GRANT,
      });

      return commandExists(command);
    },

    async run(request: AgentRunRequest): Promise<AgentRunResult> {
      const { command, args } = build(commandValues(request));

      options.log?.(`Agent ${options.name} starting task ${request.taskId}`);
      const result = await runCommand(command, args, request.workspacePath, {
        timeoutMs: resolveTimeoutMs(request.timeoutMs, options.timeoutMs),
        log: options.log,
        agentName: options.name,
      });
      options.log?.(`Agent ${options.name} finished task ${request.taskId} with status ${result.status}`);
      return result;
    },

    commandPreview(request: AgentRunRequest): InterpolatedCommand {
      return build(commandValues(request));
    },
  };
}

/**
 * The grant an adapter assumes when a caller resolved none. Deliberately the minimum a run needs to
 * produce Proof at all — never the host machine's own defaults, which is what the launch constant
 * this replaced effectively granted.
 */
const WORKSPACE_ONLY_GRANT: AgentCapabilityGrant = {
  granted: ["workspace_read", "workspace_write"],
  withheld: [],
  id: "workspace_read+workspace_write",
};

function commandValues(request: AgentRunRequest): CommandValues {
  return {
    prompt: request.prompt,
    workspace: request.workspacePath,
    promptPath: request.promptPath,
    grant: request.grant ?? WORKSPACE_ONLY_GRANT,
  };
}

/** Built-in Claude Code tools each Runtime Capability unlocks. Exhaustive over the union. */
const CLAUDE_TOOLS_BY_CAPABILITY: Record<RuntimeCapability, string[]> = {
  workspace_read: ["Read", "Glob", "Grep"],
  workspace_write: ["Write", "Edit"],
  run_command: ["Bash"],
  web_research: ["WebSearch", "WebFetch"],
};

export function claudeToolsForGrant(grant: AgentCapabilityGrant): string[] {
  return grant.granted.flatMap((capability) => CLAUDE_TOOLS_BY_CAPABILITY[capability]);
}

/**
 * Launch Claude Code fail-closed, then grant capabilities back (ADR 0021).
 *
 * - `--restricted` removes the shell and code-running tools, ignores user, project and local settings
 *   files, confines the file tools to the working directory, and refuses `bypassPermissions`. It is
 *   what stops a run from inheriting the operator's machine.
 * - `--strict-mcp-config` keeps host MCP servers out.
 * - `--permission-prompts none` makes an unanswerable prompt a deterministic denial rather than an
 *   accidental one.
 * - `--tools` says which built-in tools exist; `--allowedTools` pre-answers the prompt for the ones
 *   that would otherwise ask. Both are needed — `--tools WebSearch` alone still asks, which is the
 *   exact denial that produced the "sandbox environment" deliverable.
 */
export function createClaudeCodeAdapter(options: Pick<CliAgentOptions, "timeoutMs" | "log"> = {}): CliAgentAdapter {
  return createCliAgentAdapter({
    id: "claude-code",
    name: "Claude Code",
    capabilities: ["code", "frontend", "research", "writing"],
    buildCommand: ({ prompt, grant }) => {
      const tools = claudeToolsForGrant(grant);
      return {
        command: "claude",
        args: [
          "-p",
          "--restricted",
          "--strict-mcp-config",
          "--permission-prompts",
          "none",
          // `--tools ""` is the CLI's "no built-in tools at all", which is what an empty grant means.
          "--tools",
          tools.join(","),
          // Nothing to pre-approve when nothing exists; the flag would be meaningless.
          ...(tools.length > 0 ? ["--allowedTools", tools.join(",")] : []),
          "--permission-mode",
          "acceptEdits",
          "--no-session-persistence",
          "--",
          prompt,
        ],
      };
    },
    probeSession: () => probeCliSession("claude", ["--help"], "--input-format"),
    ...options,
  });
}

export function createCodexAdapter(
  options: Pick<CliAgentOptions, "timeoutMs" | "log"> & { model?: string } = {},
): CliAgentAdapter {
  const model = options.model ?? process.env.AUTO_CROP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL;

  return createCliAgentAdapter({
    id: "codex",
    name: "Codex",
    capabilities: ["code", "frontend", "test", "refactor"],
    buildCommand: ({ prompt, workspace, grant }) => ({
      command: "codex",
      args: [
        "exec",
        "-m",
        model,
        "-C",
        workspace,
        // The config-isolation half: do not read `$CODEX_HOME/config.toml` or user/project `.rules`.
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--sandbox",
        grant.granted.includes("run_command") ? "workspace-write" : "read-only",
        "--ephemeral",
        "-c",
        `tools.web_search=${grant.granted.includes("web_research")}`,
        prompt,
      ],
    }),
    ...options,
  });
}

/**
 * Cheap availability check for a CLI's persistent-session path: does its help text name the flag the
 * session transport needs. A failure means "run one-shot", never "adapter unavailable" — the one-shot
 * path is the default execution model and must not be gated on a session feature.
 */
async function probeCliSession(
  command: string,
  args: string[],
  requiredFlag: string,
): Promise<AgentSessionProbeResult> {
  const result = await runCommand(command, args, process.cwd(), {
    timeoutMs: 15_000,
    agentName: command,
  });

  if (result.status !== "complete") {
    return { status: "unavailable", reason: `${command} help probe failed` };
  }

  return result.stdout.includes(requiredFlag)
    ? { status: "available" }
    : { status: "unavailable", reason: `${command} does not expose ${requiredFlag}` };
}

export function interpolateCommandTemplate(
  template: string,
  values: { prompt: string; workspace: string; promptPath: string },
): InterpolatedCommand {
  const [command, ...args] = splitCommand(template).map((part) =>
    part
      .replaceAll("{prompt}", values.prompt)
      .replaceAll("{workspace}", values.workspace)
      .replaceAll("{promptPath}", values.promptPath),
  );

  if (!command) {
    throw new Error("Command template must include a command.");
  }

  return { command, args };
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(`command -v ${quoteShell(command)}`, {
      shell: true,
      stdio: "ignore",
    });

    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function resolveTimeoutMs(requestTimeoutMs: number | undefined, optionTimeoutMs: number | undefined): number {
  return requestTimeoutMs ?? optionTimeoutMs ?? 120_000;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options: { timeoutMs: number; log?: (line: string) => void; agentName: string },
): Promise<AgentRunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      options.log?.(`Agent ${options.agentName} timed out after ${options.timeoutMs}ms.`);
      resolve({
        status: "failed",
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: [stderr, `Agent command timed out after ${options.timeoutMs}ms.`].filter(Boolean).join("\n"),
        failureReason: "timeout",
      });
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      options.log?.(`Agent ${options.agentName} stdout: ${chunk.toString("utf8").trimEnd()}`);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      options.log?.(`Agent ${options.agentName} stderr: ${chunk.toString("utf8").trimEnd()}`);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        status: "failed",
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: error.message,
        failureReason: "agent_failed",
      });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        status: code === 0 ? "complete" : "failed",
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        failureReason: code === 0 ? undefined : "agent_failed",
      });
    });
  });
}

function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const char of command) {
    if ((char === "'" || char === '"') && quote === null) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (char === " " && quote === null) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote !== null) {
    throw new Error("Command template contains an unterminated quote.");
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
}
