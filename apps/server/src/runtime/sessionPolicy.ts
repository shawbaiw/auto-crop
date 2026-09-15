import type { AgentSessionKey } from "../adapters/types";
import type { PolicyMode } from "../policies/policy";

export type AgentSessionPurpose = "ceo_blueprint" | "replan_planner" | "worker_task";

export type AgentSessionPolicyInput = {
  companyId: string;
  agentId: string;
  permissionMode?: PolicyMode | null;
  purpose: AgentSessionPurpose;
  /**
   * The Agent Capability Grant this run will execute under. Part of the session's identity for the
   * same reason Permission Mode is: a session started under one grant must not serve a run that was
   * granted something else (ADR 0021).
   */
  grantId?: string | null;
  env?: Record<string, string | undefined>;
};

export type AgentSessionPolicyDecision =
  | {
      status: "enabled";
      key: AgentSessionKey;
    }
  | {
      status: "disabled";
      reason: "env_disabled" | "purpose_not_eligible" | "missing_permission_mode" | "missing_grant";
    };

const enabledPurposes = new Set<AgentSessionPurpose>(["ceo_blueprint", "replan_planner"]);

export function resolveAgentSessionPolicy(input: AgentSessionPolicyInput): AgentSessionPolicyDecision {
  const env = input.env ?? process.env;
  if (!isSessionExperimentEnabled(env)) {
    return { status: "disabled", reason: "env_disabled" };
  }

  if (!enabledPurposes.has(input.purpose)) {
    return { status: "disabled", reason: "purpose_not_eligible" };
  }

  if (!input.permissionMode) {
    return { status: "disabled", reason: "missing_permission_mode" };
  }

  if (!input.grantId) {
    return { status: "disabled", reason: "missing_grant" };
  }

  return {
    status: "enabled",
    key: {
      companyId: input.companyId,
      agentId: input.agentId,
      permissionMode: input.permissionMode,
      grantId: input.grantId,
    },
  };
}

function isSessionExperimentEnabled(env: Record<string, string | undefined>): boolean {
  const value = env.AUTO_CROP_EXPERIMENTAL_AGENT_SESSIONS?.trim().toLowerCase();
  return value === "1" || value === "true";
}
