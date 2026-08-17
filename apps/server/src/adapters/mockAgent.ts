import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "./types";

export type MockAgentOptions = {
  id: string;
  name: string;
  capabilities: string[];
  detected?: boolean;
  output?: string;
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
        status: "complete",
        exitCode: 0,
        stdout:
          options.output ??
          `Mock agent ${options.id} completed task ${request.taskId} in ${request.workspacePath}`,
        stderr: "",
      };
    },
  };
}
