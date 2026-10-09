import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createRuntimeActionChannel } from "./runtimeActionChannel";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

type RuntimeActionMcpEnv = Record<string, string | undefined>;

const TOOL_NAME = "submit_artifact_envelope";

export function handleRuntimeActionMcpMessage(message: JsonRpcRequest, env: RuntimeActionMcpEnv = process.env): object | null {
  if (!("id" in message)) {
    return null;
  }

  if (message.method === "initialize") {
    return response(message.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "auto-crop-runtime-actions", version: "0.0.0" },
    });
  }

  if (message.method === "tools/list") {
    return response(message.id, {
      tools: [
        {
          name: TOOL_NAME,
          description: "Submit the task's Artifact Envelope candidate to the Auto-Crop runtime.",
          inputSchema: {
            type: "object",
            additionalProperties: true,
            properties: {},
          },
        },
      ],
    });
  }

  if (message.method === "tools/call") {
    const params = isRecord(message.params) ? message.params : {};
    if (params.name !== TOOL_NAME) {
      return error(message.id, -32602, `Unknown tool: ${String(params.name)}`);
    }
    const context = runtimeContext(env);
    if (!context) {
      return error(message.id, -32000, "Runtime action context is not configured.");
    }
    const result = createRuntimeActionChannel({ candidateDir: context.candidateDir }).submitArtifactEnvelope(
      {
        companyId: context.companyId,
        taskId: context.taskId,
        runId: context.runId,
      },
      params.arguments,
    );
    return response(message.id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
      isError: !result.ok,
    });
  }

  return error(message.id, -32601, `Method not found: ${String(message.method)}`);
}

function runtimeContext(env: RuntimeActionMcpEnv): null | {
  candidateDir: string;
  companyId: string;
  taskId: string;
  runId: string;
} {
  const candidateDir = env.AUTO_CROP_RUNTIME_ACTION_DIR;
  const companyId = env.AUTO_CROP_RUNTIME_ACTION_COMPANY_ID;
  const taskId = env.AUTO_CROP_RUNTIME_ACTION_TASK_ID;
  const runId = env.AUTO_CROP_RUNTIME_ACTION_RUN_ID;
  return candidateDir && companyId && taskId && runId ? { candidateDir, companyId, taskId, runId } : null;
}

function response(id: string | number | null, result: unknown): object {
  return { jsonrpc: "2.0", id, result };
}

function error(id: string | number | null, code: number, message: string): object {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const lines = createInterface({ input: process.stdin, terminal: false });
  lines.on("line", (line) => {
    try {
      const output = handleRuntimeActionMcpMessage(JSON.parse(line));
      if (output) {
        process.stdout.write(`${JSON.stringify(output)}\n`);
      }
    } catch (caught) {
      process.stderr.write(`Invalid MCP message: ${(caught as Error).message}\n`);
    }
  });
}
