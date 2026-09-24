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
  suspectAfterMs: number;
  lostAfterMs: number;
  quietAfterMs: number;
  resumeGraceMs: number;
};
export type BudgetSnapshot = BudgetPolicy & {
  version: typeof BUDGET_POLICY_VERSION;
  softMs: number;
  environment: { agentTimeoutMs: string | null; forceAgentTimeoutMs: string | null };
};
/** Policy resolved and pinned once per run. Production defaults remain observe. */
export function resolveBudgetSnapshot(policy: Partial<BudgetPolicy>, timeout: EffectiveTimeoutResolution, env = process.env): BudgetSnapshot {
  const result: BudgetSnapshot = {
    runHardMs: 1_200_000, taskTotalMs: 2_700_000, briefMs: 60_000, repairMs: 120_000,
    finalizeMs: 60_000, checkpointMs: 60_000, persistMs: 5_000, clockToleranceMs: 5_000,
    suspectAfterMs: 45_000, lostAfterMs: 90_000, quietAfterMs: 60_000, resumeGraceMs: 30_000,
    ...policy, version: BUDGET_POLICY_VERSION, softMs: timeout.effectiveTimeoutMs,
    environment: { agentTimeoutMs: env.AUTO_CROP_AGENT_TIMEOUT_MS ?? null, forceAgentTimeoutMs: env.AUTO_CROP_FORCE_AGENT_TIMEOUT_MS ?? null },
  };
  for (const key of ["runHardMs", "taskTotalMs", "briefMs", "repairMs", "finalizeMs", "checkpointMs", "persistMs", "clockToleranceMs", "softMs", "suspectAfterMs", "lostAfterMs", "quietAfterMs", "resumeGraceMs"] as const) {
    const value = result[key];
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid execution budget ${key}: expected a positive safe integer`);
  }
  for (const key of ["AUTO_CROP_AGENT_TIMEOUT_MS", "AUTO_CROP_FORCE_AGENT_TIMEOUT_MS"] as const) {
    const value = env[key];
    if (value !== undefined && value.trim() !== "" && (!Number.isSafeInteger(Number(value)) || Number(value) <= 0)) throw new Error(`Invalid execution budget ${key}`);
  }
  if (result.suspectAfterMs >= result.lostAfterMs || result.persistMs >= result.suspectAfterMs) throw new Error("Health windows must exceed accounting cadence and increase from suspect to lost");
  if (result.runHardMs < result.softMs) throw new Error("runHardMs must cover the soft checkpoint");
  if (result.persistMs >= result.runHardMs) throw new Error("persistMs must be shorter than runHardMs");
  return result;
}

export type ExecutionClock = { monotonicMs(): number; utcNow(): Date };
export const systemExecutionClock: ExecutionClock = {
  monotonicMs: () => performance.now(), utcNow: () => new Date(),
};

export type BudgetStopReason = "phase_budget_exhausted" | "run_budget_exhausted" | "task_budget_exhausted";
export function isBudgetExhaustion(reason: string | null | undefined): reason is BudgetStopReason {
  return reason === "phase_budget_exhausted" || reason === "run_budget_exhausted" || reason === "task_budget_exhausted";
}

/** Explicit opt-in; malformed configuration never silently falls back to observe. */
export function executionBudgetFromEnvironment(env = process.env): Partial<BudgetPolicy> | undefined {
  const mode = env.AUTO_CROP_EXECUTION_POLICY ?? "observe";
  if (mode === "observe") return undefined;
  if (mode !== BUDGET_POLICY_VERSION) throw new Error("AUTO_CROP_EXECUTION_POLICY must be observe or budget-v1");
  const configured: unknown = JSON.parse(env.AUTO_CROP_EXECUTION_BUDGET_JSON ?? "{}");
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) throw new Error("Execution budget must be a JSON object");
  const allowed = new Set(["runHardMs", "taskTotalMs", "briefMs", "repairMs", "finalizeMs", "checkpointMs", "persistMs", "clockToleranceMs", "suspectAfterMs", "lostAfterMs", "quietAfterMs", "resumeGraceMs"]);
  if (Object.keys(configured).some(key => !allowed.has(key))) throw new Error("Unknown execution budget configuration field");
  const policy = configured as Partial<BudgetPolicy>;
  // Validate without an agent profile; each actual run validates its soft checkpoint as well.
  resolveBudgetSnapshot(policy, { effectiveTimeoutMs: 1 } as EffectiveTimeoutResolution, env);
  return policy;
}
