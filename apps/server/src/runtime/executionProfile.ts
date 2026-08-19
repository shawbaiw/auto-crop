import type { Task } from "@auto-crop/core";

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

export function resolveTaskExecutionProfile(task: Pick<Task, "proofSchemaId" | "requiredCapabilities">): TaskExecutionProfile {
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

export function resolveEffectiveTimeout(
  task: Pick<Task, "proofSchemaId" | "requiredCapabilities">,
  env: NodeJS.ProcessEnv = process.env,
): EffectiveTimeoutResolution {
  const executionProfile = resolveTaskExecutionProfile(task);
  const requestedTimeoutMs = executionProfile.timeoutMs;
  const warnings: string[] = [];
  let effectiveTimeoutMs = requestedTimeoutMs;
  const normalOverride = parseTimeoutEnv("AUTO_CROP_AGENT_TIMEOUT_MS", env.AUTO_CROP_AGENT_TIMEOUT_MS);
  const forceOverride = parseTimeoutEnv("AUTO_CROP_FORCE_AGENT_TIMEOUT_MS", env.AUTO_CROP_FORCE_AGENT_TIMEOUT_MS);

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

function parseTimeoutEnv(
  name: string,
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
