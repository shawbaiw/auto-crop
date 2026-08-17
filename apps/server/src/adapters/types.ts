export type AgentCapability = string;

export type AgentRunRequest = {
  taskId: string;
  prompt: string;
  promptPath: string;
  workspacePath: string;
  metadata: Record<string, string>;
};

export type AgentRunResult = {
  status: "complete" | "failed";
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type AgentAdapter = {
  id: string;
  name: string;
  capabilities: AgentCapability[];
  detect(): Promise<boolean>;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
};
