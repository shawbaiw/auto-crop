import type { Task } from "@auto-crop/core";

export type TaskExecutionProfileName = "short" | "medium" | "long";

export type TaskExecutionProfile = {
  name: TaskExecutionProfileName;
  timeoutMs: number;
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
