import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentCapabilityGrant, RuntimeCapability } from "../policies/capabilityGrant";
import {
  CLAUDE_CODE_LAUNCH_PROBE,
  CODEX_LAUNCH_PROBE,
  DEFAULT_LAUNCH_POLICY,
  flagSpelling,
  probeLaunchSupport,
  supportsFlag,
  type AdapterLaunchSupport,
  type CliHelpProbe,
  type LaunchPlan,
  type ReadCliHelp,
} from "./launchPolicy";
import type {
  AdapterContractCapability,
  AgentAdapter,
  AgentRunRequest,
  AgentRunResult,
  AgentSessionProbeResult,
  RunObservationSink,
} from "./types";

export type CommandValues = {
  prompt: string;
  workspace: string;
  promptPath: string;
  grant: AgentCapabilityGrant;
  /** The run's Structured Output Contract, when it has one. */
  outputSchema?: Record<string, unknown>;
  /**
   * The same schema written to disk, for a CLI that takes a path rather than inline JSON. Present
   * only during `run()`: `commandPreview` creates no files, so a path-taking adapter's preview omits
   * the flag. See `createCodexAdapter`.
   */
  outputSchemaPath?: string;
  /**
   * The run's Runtime Action Channel server (ADR 0041), present only during `run()` and only for an
   * adapter that declares `artifact_envelope`. Each builder expresses it in its own CLI's shape: Claude
   * Code takes `configPath`, Codex takes the server as `-c mcp_servers.*` overrides.
   */
  runtimeActionMcp?: { server: RuntimeActionMcpServer; configPath: string };
  /**
   * What the installed CLI can enforce, for an adapter with a `launchProbe`. A builder passes only
   * flags this declares; it is never called with an `unavailable` support.
   */
  launchSupport?: AdapterLaunchSupport;
};

export type CliAgentOptions = {
  id: string;
  name: string;
  capabilities: string[];
  contractCapabilities?: AdapterContractCapability[];
  /** Grant-blind template, for generic adapters. Exactly one of this or `buildCommand` is required. */
  commandTemplate?: string;
  /** Grant-driven launch construction. Takes precedence over `commandTemplate` when both are given. */
  buildCommand?: (values: CommandValues) => InterpolatedCommand;
  /** Optional persistent-session availability check. See `docs/persistent-agent-sessions-plan.md` Task 7. */
  probeSession?: () => Promise<AgentSessionProbeResult>;
  /**
   * Reads the installed CLI's help to decide its launch support before dispatch. Without one the
   * adapter makes no launch-isolation claim and is detected by its executable alone.
   */
  launchProbe?: CliHelpProbe;
  resolveContractCapabilities?: (support: AdapterLaunchSupport | undefined) => AdapterContractCapability[];
  /** Injectable help reader, so tests can supply help text without spawning a real CLI. */
  readHelp?: ReadCliHelp;
  timeoutMs?: number;
  log?: (line: string) => void;
};

export type InterpolatedCommand = {
  command: string;
  args: string[];
};

export type CliAgentAdapter = AgentAdapter & {
  /** The command `run` would spawn for this request, under the probed launch support. */
  commandPreview(request: AgentRunRequest): Promise<InterpolatedCommand>;
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

  const launchProbe = options.launchProbe;
  const readHelp = options.readHelp ?? readCliHelp;
  // A probe whose help text was read is cached for the adapter's lifetime: the installed CLI does not
  // change under a running server (restart to pick up an upgrade). A probe that could not run the CLI
  // at all is retried, so installing the CLI later is noticed.
  let cachedLaunchPlan: LaunchPlan | undefined;
  const resolveLaunchPlan = async (probe: CliHelpProbe): Promise<LaunchPlan> => {
    if (cachedLaunchPlan) {
      return cachedLaunchPlan;
    }
    let helpWasRead = false;
    const support = await probeLaunchSupport(options.id, probe, async (command, args) => {
      const output = await readHelp(command, args);
      helpWasRead = output !== null;
      return output;
    });
    const plan: LaunchPlan = { policy: DEFAULT_LAUNCH_POLICY, support };
    if (helpWasRead) {
      cachedLaunchPlan = plan;
    }
    return plan;
  };

  return {
    id: options.id,
    name: options.name,
    capabilities: options.capabilities,
    ...(options.contractCapabilities ? { contractCapabilities: options.contractCapabilities } : {}),
    ...(options.resolveContractCapabilities
      ? { resolveContractCapabilities: async () => options.resolveContractCapabilities!(launchProbe ? (await resolveLaunchPlan(launchProbe)).support : undefined) }
      : {}),
    ...(options.probeSession ? { session: { probe: options.probeSession, getOrStart: async () => null } } : {}),
    ...(launchProbe ? { launchPlan: () => resolveLaunchPlan(launchProbe) } : {}),

    async detect(): Promise<boolean> {
      if (launchProbe) {
        return (await resolveLaunchPlan(launchProbe)).support.isolationLevel !== "unavailable";
      }

      const { command } = build({
        prompt: "",
        workspace: ".",
        promptPath: "",
        grant: WORKSPACE_ONLY_GRANT,
      });

      return commandExists(command);
    },

    async run(request: AgentRunRequest): Promise<AgentRunResult> {
      const launchSupport = launchProbe ? (await resolveLaunchPlan(launchProbe)).support : undefined;
      if (launchSupport?.isolationLevel === "unavailable") {
        // The scheduler does not dispatch here; this guards every other caller from spawning a launch
        // the CLI would reject with an unknown-option error.
        return {
          status: "failed",
          exitCode: null,
          stdout: "",
          stderr: `Agent ${options.name} is unavailable for task runs: ${launchSupport.warnings.join(" ")}`,
          failureReason: "agent_failed",
        };
      }

      // Materialized outside the workspace so it can never be mistaken for Proof, and removed after
      // the run whatever its outcome.
      const schemaDir = request.outputSchema
        ? mkdtempSync(join(tmpdir(), "auto-crop-output-schema-"))
        : null;
      const outputSchemaPath = schemaDir ? join(schemaDir, "schema.json") : undefined;
      if (outputSchemaPath && request.outputSchema) {
        writeFileSync(outputSchemaPath, JSON.stringify(request.outputSchema), "utf8");
      }
      // Whether the run gets the action surface is the adapter's own claim, so a CLI that cannot express
      // it is never handed a server it would ignore.
      const contractCapabilities = options.resolveContractCapabilities
        ? options.resolveContractCapabilities(launchSupport)
        : options.contractCapabilities ?? [];
      const mcpConfigDir = request.runtimeActions?.mcp && contractCapabilities.includes("artifact_envelope")
        ? mkdtempSync(join(tmpdir(), "auto-crop-runtime-action-mcp-"))
        : null;
      let runtimeActionMcp: CommandValues["runtimeActionMcp"];
      if (mcpConfigDir && request.runtimeActions?.mcp) {
        const server = runtimeActionMcpServer(request.runtimeActions.mcp);
        const configPath = join(mcpConfigDir, "mcp.json");
        writeFileSync(configPath, JSON.stringify(mcpConfigFile(server)), "utf8");
        runtimeActionMcp = { server, configPath };
      }

      try {
        const { command, args } = build({ ...commandValues(request), outputSchemaPath, runtimeActionMcp, launchSupport });

        options.log?.(`Agent ${options.name} starting task ${request.taskId}`);
        const result = await runCommand(command, args, request.workspacePath, {
          timeoutMs: resolveTimeoutMs(request.timeoutMs, options.timeoutMs),
          log: options.log,
          agentName: options.name,
          observe: request.observe,
          signal: request.signal,
          graceMs: request.graceMs,
          confirmMs: request.confirmMs,
        });
        options.log?.(`Agent ${options.name} finished task ${request.taskId} with status ${result.status}`);
        return result;
      } finally {
        if (schemaDir) {
          rmSync(schemaDir, { recursive: true, force: true });
        }
        if (mcpConfigDir) {
          rmSync(mcpConfigDir, { recursive: true, force: true });
        }
      }
    },

    async commandPreview(request: AgentRunRequest): Promise<InterpolatedCommand> {
      const launchSupport = launchProbe ? (await resolveLaunchPlan(launchProbe)).support : undefined;
      return build({ ...commandValues(request), launchSupport });
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
    outputSchema: request.outputSchema,
    grant: request.grant ?? WORKSPACE_ONLY_GRANT,
  };
}

/** Built-in Claude Code tools each Runtime Capability unlocks. Exhaustive over the union. */
const CLAUDE_TOOLS_BY_CAPABILITY: Record<RuntimeCapability, string[]> = {
  workspace_read: ["Read", "Glob", "Grep"],
  workspace_write: ["Write", "Edit"],
  run_command: ["Bash"],
  // Claude Code has no tool for this and no flag that withholds it: its `Bash` tool can already bind a
  // local port. Granting adds nothing here; withholding is what it cannot express (ADR 0031).
  local_network: [],
  web_research: ["WebSearch", "WebFetch"],
};

export function claudeToolsForGrant(grant: AgentCapabilityGrant): string[] {
  return grant.granted.flatMap((capability) => CLAUDE_TOOLS_BY_CAPABILITY[capability]);
}

/**
 * The Codex sandbox a grant maps to. Codex has no tool list to narrow: its sandbox is the only control,
 * and it decides whether the workspace is writable, not whether a shell exists — a `read-only` run can
 * still execute commands, it just cannot write. So `workspace_write` is what selects `workspace-write`.
 * Keying it on `run_command` instead launched every write-without-shell grant read-only, and the run
 * could not even write the Business Artifact it was required to deliver.
 */
export function codexSandboxForGrant(grant: AgentCapabilityGrant): "workspace-write" | "read-only" {
  return grant.granted.includes("workspace_write") ? "workspace-write" : "read-only";
}

/**
 * Launch Claude Code fail-closed, then grant capabilities back (ADR 0021). Each flag is passed only
 * when the installed CLI declares it (see `CLAUDE_CODE_LAUNCH_PROBE`).
 *
 * - `--restricted` removes the shell and code-running tools, ignores user, project and local settings
 *   files, confines the file tools to the working directory, and refuses `bypassPermissions`. It is
 *   what stops a run from inheriting the operator's machine. A CLI without it still launches with
 *   explicit grants, at `compatible` isolation.
 * - `--strict-mcp-config` keeps host MCP servers out.
 * - `--permission-prompts none` makes an unanswerable prompt a deterministic denial rather than an
 *   accidental one.
 * - `--tools` says which built-in tools exist; `--allowedTools` pre-answers the prompt for the ones
 *   that would otherwise ask. Both are needed — `--tools WebSearch` alone still asks, which is the
 *   exact denial that produced the "sandbox environment" deliverable.
 */
export function createClaudeCodeAdapter(
  options: Pick<CliAgentOptions, "timeoutMs" | "log" | "readHelp"> = {},
): CliAgentAdapter {
  return createCliAgentAdapter({
    id: "claude-code",
    name: "Claude Code",
    capabilities: ["code", "frontend", "research", "writing"],
    launchProbe: CLAUDE_CODE_LAUNCH_PROBE,
    resolveContractCapabilities: (support) => supportsFlagIfPresent(support, "--mcp-config") ? ["artifact_envelope"] : [],
    buildCommand: buildClaudeCodeCommand,
    probeSession: () => probeCliSession("claude", ["--help"], "--input-format"),
    ...options,
  });
}

export function createCodexAdapter(
  options: Pick<CliAgentOptions, "timeoutMs" | "log" | "readHelp"> & { model?: string } = {},
): CliAgentAdapter {
  const model = options.model ?? process.env.AUTO_CROP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL;

  return createCliAgentAdapter({
    id: "codex",
    name: "Codex",
    capabilities: ["code", "frontend", "test", "refactor"],
    // `-c` is a required launch flag, so every launchable Codex can take the action server.
    contractCapabilities: ["structured_execution_brief", "artifact_envelope"],
    launchProbe: CODEX_LAUNCH_PROBE,
    buildCommand: (values) => buildCodexCommand(model, values),
    ...options,
  });
}

/** Claude Code's launch for one run; exported so tests can see the run-time flags a preview omits. */
export function buildClaudeCodeCommand({ prompt, grant, outputSchema, runtimeActionMcp, launchSupport }: CommandValues): InterpolatedCommand {
  const support = requireLaunchSupport("claude-code", launchSupport);
  const tools = claudeToolsForGrant(grant);
  // An MCP tool is not a built-in, so `--tools` does not list it, but it still asks for permission:
  // without pre-approval `--permission-prompts none` denies the delivery call itself.
  const allowedTools = [
    ...tools,
    ...(runtimeActionMcp ? runtimeActionMcp.server.toolNames.map((tool) => `mcp__${runtimeActionMcp.server.name}__${tool}`) : []),
  ];
  const when = (flag: string, ...args: string[]) => (supportsFlag(support, flag) ? [flag, ...args] : []);
  return {
    command: "claude",
    args: [
      flagSpelling(support, "-p", "--print"),
      ...when("--restricted"),
      "--strict-mcp-config",
      ...(runtimeActionMcp && supportsFlag(support, "--mcp-config")
        ? [flagSpelling(support, "--mcp-config"), runtimeActionMcp.configPath]
        : []),
      ...when("--permission-prompts", "none"),
      // `--tools ""` is the CLI's "no built-in tools at all", which is what an empty grant means.
      "--tools",
      tools.join(","),
      // Nothing to pre-approve when nothing exists; the flag would be meaningless.
      ...(allowedTools.length > 0 ? [flagSpelling(support, "--allowedTools", "--allowed-tools"), allowedTools.join(",")] : []),
      // Inline JSON only — this flag rejects a file path.
      ...(outputSchema ? ["--json-schema", JSON.stringify(outputSchema)] : []),
      "--permission-mode",
      "acceptEdits",
      ...when("--no-session-persistence"),
      "--",
      prompt,
    ],
  };
}

/** Codex's launch for one run with `model`; exported for the same reason as {@link buildClaudeCodeCommand}. */
export function buildCodexCommand(
  model: string,
  { prompt, workspace, grant, outputSchemaPath, runtimeActionMcp, launchSupport }: CommandValues,
): InterpolatedCommand {
  const support = requireLaunchSupport("codex", launchSupport);
  return {
    command: "codex",
    args: [
      "exec",
      flagSpelling(support, "-m", "--model"),
      model,
      flagSpelling(support, "-C", "--cd"),
      workspace,
      // File path only — this flag rejects inline JSON, the mirror of Claude Code's constraint. The
      // file exists only during a run, so a preview shows the launch without it.
      ...(outputSchemaPath ? ["--output-schema", outputSchemaPath] : []),
      // The config-isolation half: do not read `$CODEX_HOME/config.toml` or user/project `.rules`.
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      flagSpelling(support, "--sandbox", "-s"),
      codexSandboxForGrant(grant),
      "--ephemeral",
      flagSpelling(support, "-c", "--config"),
      `tools.web_search=${grant.granted.includes("web_research")}`,
      // Codex's workspace-write sandbox denies every socket unless this is on, so a run that must
      // serve or reach 127.0.0.1 cannot without it — and a run that must not, cannot with it.
      flagSpelling(support, "-c", "--config"),
      `sandbox_workspace_write.network_access=${grant.granted.includes("local_network")}`,
      ...(runtimeActionMcp ? codexMcpServerOverrides(support, runtimeActionMcp.server) : []),
      prompt,
    ],
  };
}

function supportsFlagIfPresent(support: AdapterLaunchSupport | undefined, flag: string): boolean {
  return Boolean(support && support.isolationLevel !== "unavailable" && supportsFlag(support, flag));
}

type RuntimeActionMcpContext = NonNullable<NonNullable<AgentRunRequest["runtimeActions"]>["mcp"]>;

/** A stdio MCP server, independent of how any one CLI is told about it. */
export type RuntimeActionMcpServer = {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Tools the run must be allowed to call without a prompt; the delivery itself is one of them. */
  toolNames: string[];
};

export const RUNTIME_ACTION_MCP_SERVER_NAME = "auto-crop-runtime-actions";

/**
 * The server runs from TypeScript source, so it is launched with the tsx loader — resolved to an
 * absolute URL here, because the CLI starts it in the task workspace, where a bare `tsx` specifier
 * resolves against a directory that has no `node_modules`.
 */
export function runtimeActionMcpServer(context: RuntimeActionMcpContext): RuntimeActionMcpServer {
  const serverPath = fileURLToPath(new URL("../runtime/runtimeActionMcpServer.ts", import.meta.url));
  const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
  return {
    name: RUNTIME_ACTION_MCP_SERVER_NAME,
    command: process.execPath,
    args: ["--import", tsxLoader, serverPath],
    env: {
      AUTO_CROP_RUNTIME_ACTION_DIR: context.candidateDir,
      AUTO_CROP_RUNTIME_ACTION_COMPANY_ID: context.companyId,
      AUTO_CROP_RUNTIME_ACTION_TASK_ID: context.taskId,
      AUTO_CROP_RUNTIME_ACTION_RUN_ID: context.runId,
    },
    toolNames: ["submit_artifact_envelope"],
  };
}

function mcpConfigFile(server: RuntimeActionMcpServer): object {
  return { mcpServers: { [server.name]: { command: server.command, args: server.args, env: server.env } } };
}

/**
 * The server as `-c` overrides, since `--ignore-user-config` leaves Codex no config file to name it in.
 * Values are TOML; a JSON string is a valid TOML basic string. `codex exec` runs with approvals off,
 * which cancels any MCP call that would ask, so this server's tools are pre-approved.
 */
function codexMcpServerOverrides(support: AdapterLaunchSupport, server: RuntimeActionMcpServer): string[] {
  const key = `mcp_servers.${server.name}`;
  const env = Object.entries(server.env).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join(",");
  return [
    `${key}.command=${JSON.stringify(server.command)}`,
    `${key}.args=[${server.args.map((arg) => JSON.stringify(arg)).join(",")}]`,
    `${key}.env={${env}}`,
    `${key}.default_tools_approval_mode="approve"`,
  ].flatMap((override) => [flagSpelling(support, "-c", "--config"), override]);
}

function requireLaunchSupport(adapterId: string, support: AdapterLaunchSupport | undefined): AdapterLaunchSupport {
  if (!support || support.isolationLevel === "unavailable") {
    throw new Error(`Agent adapter ${adapterId} built a launch without an available launch support profile.`);
  }
  return support;
}

async function readCliHelp(command: string, args: string[]): Promise<string | null> {
  const result = await runCommand(command, args, process.cwd(), { timeoutMs: 15_000, agentName: command });
  return result.status === "complete" ? [result.stdout, result.stderr].join("\n") : null;
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

/**
 * How long a process gets to exit on its own after being asked, before the group is killed.
 *
 * Long enough for an agent CLI to finish the syscall it is in and flush what it has written; short
 * enough that a stop request is not indistinguishable from a hang.
 */
export const TERMINATION_GRACE_MS = 10_000;

/** How long after SIGKILL the runtime waits for proof the process is actually gone. */
export const TERMINATION_CONFIRM_MS = 5_000;

/**
 * Stop a running agent and say what is actually known about whether it stopped.
 *
 * `stopped` means the process group exited and was reaped. `unconfirmed` means it did not, within the
 * confirmation window, after SIGKILL — the runtime cannot prove the process is gone, which matters
 * because it may still be writing to the workspace. Nothing downstream may treat `unconfirmed` as
 * "terminated": the plan's containment rule is that an unproven termination isolates rather than
 * re-runs (execution-health §7).
 */
export type TerminationOutcome = "stopped" | "unconfirmed";

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options: {
    timeoutMs: number;
    log?: (line: string) => void;
    agentName: string;
    observe?: RunObservationSink;
    signal?: AbortSignal;
    graceMs?: number;
    confirmMs?: number;
  },
): Promise<AgentRunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so stopping the agent stops what the agent started. An agent CLI
      // spawns compilers, test runners and servers; signalling only the process we hold leaves those
      // behind, still holding the workspace this task is about to be retried in.
      detached: canGroupSignal,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let exited = false;
    let terminationOutcome: TerminationOutcome | null = null;
    let stopping: { reason: "timeout" | "cancelled"; message: string } | null = null;
    const pending: Array<ReturnType<typeof setTimeout>> = [];
    const later = (fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      pending.push(timer);
      return timer;
    };
    const clearPending = () => {
      for (const timer of pending.splice(0)) {
        clearTimeout(timer);
      }
    };

    /**
     * Signal the child's process group, or the child alone where groups are unavailable.
     *
     * Guarded on the child not having exited: after a process is reaped its pid can be reused, and
     * signalling a reused pid kills something that has nothing to do with this run.
     */
    const signalTree = (signal: NodeJS.Signals): void => {
      if (exited || child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
        return;
      }
      try {
        if (canGroupSignal) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        // ESRCH: it is already gone, which is the outcome we wanted.
      }
    };

    /** Ask, then insist, then report honestly about what could not be confirmed. */
    const terminate = (): void => {
      signalTree("SIGTERM");
      later(() => {
        if (exited) {
          return;
        }
        signalTree("SIGKILL");
        later(() => {
          if (!exited) {
            terminationOutcome = "unconfirmed";
            options.log?.(
              `Agent ${options.agentName} did not exit after SIGKILL; termination is unconfirmed.`,
            );
          }
        }, options.confirmMs ?? TERMINATION_CONFIRM_MS);
      }, options.graceMs ?? TERMINATION_GRACE_MS);
    };

    const finish = (result: AgentRunResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearPending();
      options.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    /**
     * Settle a stop once the process is known to be gone, or once we have to admit it is not.
     *
     * A stop that resolves the moment the signal is sent reports a process as finished while it is
     * still running — which is how a second execution used to start in a directory the first one was
     * still writing to.
     */
    const settleStop = (reason: "timeout" | "cancelled", message: string): void => {
      if (stopping) {
        return;
      }
      // From here the run's outcome is the stop, not whatever exit code the process produces on its
      // way out: a process killed for running too long exits non-zero, and reporting that as the
      // agent having failed loses the only fact that mattered.
      stopping = { reason, message };
      terminate();
      // Resolve when it exits; otherwise when the confirmation window has run out, reporting the
      // termination as unconfirmed rather than pretending it landed.
      later(reportStop, (options.graceMs ?? TERMINATION_GRACE_MS) + (options.confirmMs ?? TERMINATION_CONFIRM_MS) + 50);
    };

    function reportStop(): void {
      if (!stopping) {
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const confirmation =
        terminationOutcome === "unconfirmed"
          ? "The process did not exit after SIGKILL; termination is unconfirmed."
          : null;
      finish({
        status: "failed",
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: [stderr, stopping.message, confirmation].filter(Boolean).join("\n"),
        failureReason: stopping.reason === "timeout" ? "timeout" : "cancelled",
        terminationConfirmed: terminationOutcome !== "unconfirmed",
      });
    }

    function onAbort(): void {
      if (settled) {
        return;
      }
      options.log?.(`Agent ${options.agentName} was asked to stop.`);
      settleStop("cancelled", "The agent was stopped by the runtime.");
    }

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    later(() => {
      if (settled) {
        return;
      }
      options.log?.(`Agent ${options.agentName} timed out after ${options.timeoutMs}ms.`);
      settleStop("timeout", `Agent command timed out after ${options.timeoutMs}ms.`);
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      // Report that bytes moved, not what they were: the log already holds the text.
      options.observe?.output("stdout", chunk.length);
      options.log?.(`Agent ${options.agentName} stdout: ${chunk.toString("utf8").trimEnd()}`);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      options.observe?.output("stderr", chunk.length);
      options.log?.(`Agent ${options.agentName} stderr: ${chunk.toString("utf8").trimEnd()}`);
    });
    child.on("error", (error) => {
      exited = true;
      finish({
        status: "failed",
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: error.message,
        failureReason: "agent_failed",
      });
    });
    child.on("close", (code) => {
      exited = true;
      if (stopping) {
        // It exited because we asked it to. The stop is the outcome.
        reportStop();
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      // A natural exit also needs evidence for automatic recovery. Only an absent POSIX group
      // proves that no in-group child remains; permission errors and unsupported platforms are unknown.
      let terminationConfirmed: true | undefined;
      if (canGroupSignal && child.pid !== undefined) {
        try { process.kill(-child.pid, 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") terminationConfirmed = true; }
      }
      finish({
        status: code === 0 ? "complete" : "failed",
        terminationConfirmed,
        exitCode: code,
        stdout,
        stderr,
        failureReason:
          code === 0 ? undefined : isQuotaExhaustedOutput(`${stdout}\n${stderr}`) ? "agent_quota_exhausted" : "agent_failed",
      });
    });
  });
}

/**
 * Whether this platform can signal a whole process group.
 *
 * Unix gives a detached child its own group, so one signal reaches everything it started. Windows has
 * no equivalent here, so termination covers the process we hold and no further — a containment limit
 * to state plainly rather than a tree we can claim to have stopped.
 */
const canGroupSignal = process.platform !== "win32";

/**
 * Whether a CLI stopped because its account is out of quota rather than because the work failed.
 *
 * This reads the CLI's own operational message, not the agent's reply — the distinction the runtime
 * keeps everywhere else. There is no exit code or structured field for it on either CLI, and the
 * alternative is to record a quota outage as a failed attempt by the agent: a wrong cause, and one
 * that burns the task's recovery ceiling while the account waits to reset (ADR 0032).
 */
export function isQuotaExhaustedOutput(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("session limit") ||
    normalized.includes("usage limit") ||
    normalized.includes("quota exceeded") ||
    normalized.includes("rate limit reached")
  );
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
