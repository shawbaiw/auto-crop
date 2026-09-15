import type { Task } from "@auto-crop/core";
import type { AgentCapabilityGrant, RuntimeCapability } from "../policies/capabilityGrant";

export type TaskExecutionProfileName = "short" | "medium" | "long";

export type TaskExecutionProfile = {
  name: TaskExecutionProfileName;
  timeoutMs: number;
};

export type EffectiveTimeoutResolution = {
  executionProfile: TaskExecutionProfile;
  requestedTimeoutMs: number;
  effectiveTimeoutMs: number;
  warnings: string[];
};

const shortProfile = { name: "short", timeoutMs: 120_000 } as const satisfies TaskExecutionProfile;
const mediumProfile = { name: "medium", timeoutMs: 300_000 } as const satisfies TaskExecutionProfile;
const longProfile = { name: "long", timeoutMs: 600_000 } as const satisfies TaskExecutionProfile;

/**
 * Minimum profile a Runtime Capability's wall-clock cost demands, regardless of deliverable shape.
 *
 * `research-report` and `product-brief` were sized `short` (120s) for a task writing down what the
 * agent already knew. A run that actually searches the web and reads pages cannot fit that, and the
 * floor is derived from the grant rather than added to the proof-schema table so a later
 * network-bound capability inherits the rule instead of needing its own row (ADR 0021).
 */
const capabilityProfileFloor: Partial<Record<RuntimeCapability, TaskExecutionProfileName>> = {
  web_research: "medium",
};

export function resolveTaskExecutionProfile(
  task: Pick<Task, "proofSchemaId" | "requiredCapabilities">,
  grant?: AgentCapabilityGrant,
): TaskExecutionProfile {
  return applyGrantFloor(profileFromTaskShape(task), grant);
}

function profileFromTaskShape(task: Pick<Task, "proofSchemaId" | "requiredCapabilities">): TaskExecutionProfile {
  switch (task.proofSchemaId) {
    case "product-brief":
    case "research-report":
      return shortProfile;
    case "repo-diff":
      return mediumProfile;
    case "landing-page-file":
    case "test-output":
      return longProfile;
    default:
      return profileFromCapabilities(task.requiredCapabilities);
  }
}

function applyGrantFloor(
  profile: TaskExecutionProfile,
  grant: AgentCapabilityGrant | undefined,
): TaskExecutionProfile {
  let result = profile;

  for (const capability of grant?.granted ?? []) {
    const floor = capabilityProfileFloor[capability];
    if (floor && profileRank(floor) > profileRank(result.name)) {
      result = profileByName(floor);
    }
  }

  return result;
}

function profileRank(name: TaskExecutionProfileName): number {
  return name === "short" ? 0 : name === "medium" ? 1 : 2;
}

export function resolveEffectiveTimeout(
  task: Pick<Task, "proofSchemaId" | "requiredCapabilities">,
  env: NodeJS.ProcessEnv = process.env,
  grant?: AgentCapabilityGrant,
): EffectiveTimeoutResolution {
  const executionProfile = resolveTaskExecutionProfile(task, grant);
  return resolveEffectiveTimeoutForProfile(executionProfile, env);
}

export function resolveRetryTimeout(
  resolution: Pick<EffectiveTimeoutResolution, "executionProfile">,
  env: NodeJS.ProcessEnv = process.env,
): EffectiveTimeoutResolution | null {
  const retryProfile = nextExecutionProfile(resolution.executionProfile.name);

  return retryProfile ? resolveEffectiveTimeoutForProfile(retryProfile, env) : null;
}

export function resolveEffectiveTimeoutForProfileName(
  profileName: TaskExecutionProfileName,
  env: NodeJS.ProcessEnv = process.env,
): EffectiveTimeoutResolution {
  return resolveEffectiveTimeoutForProfile(profileByName(profileName), env);
}

function resolveEffectiveTimeoutForProfile(
  executionProfile: TaskExecutionProfile,
  env: NodeJS.ProcessEnv,
): EffectiveTimeoutResolution {
  const requestedTimeoutMs = executionProfile.timeoutMs;
  const warnings: string[] = [];
  let effectiveTimeoutMs = requestedTimeoutMs;
  const normalOverride = parseTimeoutEnv(env.AUTO_CROP_AGENT_TIMEOUT_MS);
  const forceOverride = parseTimeoutEnv(env.AUTO_CROP_FORCE_AGENT_TIMEOUT_MS);

  if (normalOverride.kind === "invalid") {
    warnings.push(`Ignored invalid AUTO_CROP_AGENT_TIMEOUT_MS: ${normalOverride.raw}.`);
  } else if (normalOverride.kind === "valid" && normalOverride.value > requestedTimeoutMs) {
    effectiveTimeoutMs = normalOverride.value;
  } else if (normalOverride.kind === "valid" && normalOverride.value < requestedTimeoutMs) {
    warnings.push(
      `Ignored AUTO_CROP_AGENT_TIMEOUT_MS=${normalOverride.value} because it is lower than the ${executionProfile.name} profile budget ${requestedTimeoutMs}.`,
    );
  }

  if (forceOverride.kind === "invalid") {
    warnings.push(`Ignored invalid AUTO_CROP_FORCE_AGENT_TIMEOUT_MS: ${forceOverride.raw}.`);
  } else if (forceOverride.kind === "valid") {
    effectiveTimeoutMs = forceOverride.value;
  }

  return {
    executionProfile,
    requestedTimeoutMs,
    effectiveTimeoutMs,
    warnings,
  };
}

export function formatExecutionBudget(timeoutMs: number): string {
  const seconds = timeoutMs / 1000;

  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }

  return `${seconds}s`;
}

function profileFromCapabilities(requiredCapabilities: string[]): TaskExecutionProfile {
  const capabilities = new Set(requiredCapabilities);

  if (capabilities.has("frontend") || capabilities.has("test")) {
    return longProfile;
  }

  if (capabilities.has("code") || capabilities.has("refactor")) {
    return mediumProfile;
  }

  return mediumProfile;
}

function profileByName(profileName: TaskExecutionProfileName): TaskExecutionProfile {
  switch (profileName) {
    case "short":
      return shortProfile;
    case "medium":
      return mediumProfile;
    case "long":
      return longProfile;
  }
}

function nextExecutionProfile(profileName: TaskExecutionProfileName): TaskExecutionProfile | null {
  switch (profileName) {
    case "short":
      return mediumProfile;
    case "medium":
      return longProfile;
    case "long":
      return null;
  }
}

function parseTimeoutEnv(
  raw: string | undefined,
): { kind: "unset" } | { kind: "invalid"; raw: string } | { kind: "valid"; value: number } {
  if (raw === undefined || raw.trim() === "") {
    return { kind: "unset" };
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0) {
    return { kind: "invalid", raw };
  }

  return { kind: "valid", value };
}
