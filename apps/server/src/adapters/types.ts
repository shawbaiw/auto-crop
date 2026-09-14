import type { AgentFailureReason } from "@auto-crop/core";
import type { AgentCapabilityGrant } from "../policies/capabilityGrant";

export type AgentCapability = string;

export type AgentRunRequest = {
  taskId: string;
  prompt: string;
  promptPath: string;
  workspacePath: string;
  metadata: Record<string, string>;
  timeoutMs?: number;
  /**
   * What this run is permitted to do. Resolved once by the runtime (ADR 0021); an adapter translates
   * it into its own launch flags and decides nothing else about it. Absent means the caller did not
   * resolve a grant, and the adapter falls back to a read/write-only workspace grant rather than to
   * whatever the host machine would have allowed.
   */
  grant?: AgentCapabilityGrant;
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
  /**
   * The Agent Capability Grant id the session was started under. A session is a live process holding
   * the capabilities it was launched with, so serving a run from a session started under a different
   * grant would hand that run capabilities it was never granted (ADR 0021).
   */
  grantId: string;
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
