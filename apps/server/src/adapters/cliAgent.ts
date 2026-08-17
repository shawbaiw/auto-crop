import { spawn } from "node:child_process";
import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "./types";

export type CliAgentOptions = {
  id: string;
  name: string;
  capabilities: string[];
  commandTemplate: string;
};

export type InterpolatedCommand = {
  command: string;
  args: string[];
};

export type CliAgentAdapter = AgentAdapter & {
  commandPreview(request: AgentRunRequest): InterpolatedCommand;
};

export function createCliAgentAdapter(options: CliAgentOptions): CliAgentAdapter {
  return {
    id: options.id,
    name: options.name,
    capabilities: options.capabilities,

    async detect(): Promise<boolean> {
      const { command } = interpolateCommandTemplate(options.commandTemplate, {
        prompt: "",
        workspace: ".",
        promptPath: "",
      });

      return commandExists(command);
    },

    async run(request: AgentRunRequest): Promise<AgentRunResult> {
      const { command, args } = interpolateCommandTemplate(options.commandTemplate, {
        prompt: request.prompt,
        workspace: request.workspacePath,
        promptPath: request.promptPath,
      });

      return runCommand(command, args, request.workspacePath);
    },

    commandPreview(request: AgentRunRequest): InterpolatedCommand {
      return interpolateCommandTemplate(options.commandTemplate, {
        prompt: request.prompt,
        workspace: request.workspacePath,
        promptPath: request.promptPath,
      });
    },
  };
}

export function createClaudeCodeAdapter(): CliAgentAdapter {
  return createCliAgentAdapter({
    id: "claude-code",
    name: "Claude Code",
    capabilities: ["code", "frontend", "research", "writing"],
    commandTemplate: "claude -p --permission-mode acceptEdits --no-session-persistence -- {prompt}",
  });
}

export function createCodexAdapter(): CliAgentAdapter {
  return createCliAgentAdapter({
    id: "codex",
    name: "Codex",
    capabilities: ["code", "frontend", "test", "refactor"],
    commandTemplate: "codex exec -C {workspace} --skip-git-repo-check --sandbox workspace-write --ephemeral {prompt}",
  });
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

function runCommand(command: string, args: string[], cwd: string): Promise<AgentRunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      resolve({
        status: "failed",
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: error.message,
      });
    });
    child.on("close", (code) => {
      resolve({
        status: code === 0 ? "complete" : "failed",
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
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
