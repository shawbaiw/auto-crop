import type { AgentFailureReason } from "@auto-crop/core";

export type AgentCapability = string;

export type AgentRunRequest = {
  taskId: string;
  prompt: string;
  promptPath: string;
  workspacePath: string;
  metadata: Record<string, string>;
  timeoutMs?: number;
};

export type AgentRunResult = {
  status: "complete" | "failed";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  failureReason?: AgentFailureReason;
};

export type AgentSessionKey = {
  companyId: string;
  agentId: string;
  permissionMode: string;
};

export type AgentSessionProbeResult =
  | {
      status: "available";
    }
  | {
      status: "unavailable";
      reason: string;
    };

export type AgentSession = {
  id: string;
  key: AgentSessionKey;
  alive: boolean;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  stop(reason: string): void;
};

export type AgentSessionCapability = {
  probe?(key: AgentSessionKey): Promise<AgentSessionProbeResult>;
  getOrStart(key: AgentSessionKey): Promise<AgentSession | null>;
};

export type AgentAdapter = {
  id: string;
  name: string;
  capabilities: AgentCapability[];
  detect(): Promise<boolean>;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  session?: AgentSessionCapability;
};
