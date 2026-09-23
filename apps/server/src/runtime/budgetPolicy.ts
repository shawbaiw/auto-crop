import type { EffectiveTimeoutResolution } from "./executionProfile";

export const BUDGET_POLICY_VERSION = "budget-v1";
export type BudgetPhase = "starting" | "preparing_brief" | "executing" | "repairing_artifact" | "finalizing";
export type BudgetPolicy = {
  runHardMs: number;
  taskTotalMs: number;
  briefMs: number;
  repairMs: number;
  finalizeMs: number;
  checkpointMs: number;
  persistMs: number;
  clockToleranceMs: number;
};
export type BudgetSnapshot = BudgetPolicy & {
  version: typeof BUDGET_POLICY_VERSION;
  softMs: number;
  environment: { agentTimeoutMs: string | null; forceAgentTimeoutMs: string | null };
};
/** Internal opt-in only until the P4.2/P4.3 stopping and user-facing flows are accepted. */
export function resolveBudgetSnapshot(policy: Partial<BudgetPolicy>, timeout: EffectiveTimeoutResolution, env = process.env): BudgetSnapshot {
  const result: BudgetSnapshot = {
    runHardMs: 1_200_000, taskTotalMs: 2_700_000, briefMs: 60_000, repairMs: 120_000,
    finalizeMs: 60_000, checkpointMs: 60_000, persistMs: 5_000, clockToleranceMs: 5_000,
    ...policy, version: BUDGET_POLICY_VERSION, softMs: timeout.effectiveTimeoutMs,
    environment: { agentTimeoutMs: env.AUTO_CROP_AGENT_TIMEOUT_MS ?? null, forceAgentTimeoutMs: env.AUTO_CROP_FORCE_AGENT_TIMEOUT_MS ?? null },
  };
  for (const key of ["runHardMs", "taskTotalMs", "briefMs", "repairMs", "finalizeMs", "checkpointMs", "persistMs", "clockToleranceMs", "softMs"] as const) {
    const value = result[key];
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid execution budget ${key}: expected a positive safe integer`);
  }
  for (const key of ["AUTO_CROP_AGENT_TIMEOUT_MS", "AUTO_CROP_FORCE_AGENT_TIMEOUT_MS"] as const) {
    const value = env[key];
    if (value !== undefined && value.trim() !== "" && (!Number.isSafeInteger(Number(value)) || Number(value) <= 0)) throw new Error(`Invalid execution budget ${key}`);
  }
  if (result.runHardMs < result.softMs) throw new Error("runHardMs must cover the soft checkpoint");
  if (result.persistMs >= result.runHardMs) throw new Error("persistMs must be shorter than runHardMs");
  return result;
}

export type ExecutionClock = { monotonicMs(): number; utcNow(): Date };
export const systemExecutionClock: ExecutionClock = {
  monotonicMs: () => performance.now(), utcNow: () => new Date(),
};
