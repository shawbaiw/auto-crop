import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "./types";

export type MockAgentOptions = {
  id: string;
  name: string;
  capabilities: string[];
  detected?: boolean;
  output?: string;
  status?: AgentRunResult["status"];
  failureReason?: AgentRunResult["failureReason"];
};

export function createMockAgentAdapter(options: MockAgentOptions): AgentAdapter {
  return {
    id: options.id,
    name: options.name,
    capabilities: options.capabilities,
    async detect(): Promise<boolean> {
      return options.detected ?? true;
    },
    async run(request: AgentRunRequest): Promise<AgentRunResult> {
      return {
        status: options.status ?? "complete",
        exitCode: options.status === "failed" ? 1 : 0,
        stdout:
          options.output ??
          `Mock agent ${options.id} completed task ${request.taskId} in ${request.workspacePath}`,
        stderr: "",
        failureReason: options.failureReason ?? (options.status === "failed" ? "agent_failed" : undefined),
      };
    },
  };
}
