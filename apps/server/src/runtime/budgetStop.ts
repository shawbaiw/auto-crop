import type { createRepositories } from "../db/repositories";
import { recordExecutionEvent, type ExecutionBudgetFacts } from "./executionEvents";

type Repositories = ReturnType<typeof createRepositories>;
export function executionBudgetFacts(repositories: Repositories, runId: string): ExecutionBudgetFacts | undefined {
  const budget = repositories.executionBudget.getRun(runId);
  if (!budget) return undefined;
  const stop = repositories.executionBudget.stopRequest(runId);
  return { reservedMs: budget.reserved_ms, consumedMs: Math.max(budget.consumed_ms, stop?.consumed_ms ?? 0), estimated: Boolean(budget.estimated),
    stopReason: stop?.reason ?? null, stopPhase: stop?.phase ?? null, stopRequestedAt: stop?.requested_at ?? null,
    terminationWaitMs: stop?.termination_wait_ms ?? null };
}

/** The stop claim fences every success writer, and its event commits before signalling a process. */
export function requestBudgetStop(input: {
  repositories: Repositories; runId: string; reason: string; phase: string; at: string; usedMs: number;
}): boolean {
  return input.repositories.transaction(() => {
    if (!input.repositories.executionBudget.requestStop(input.runId, input.reason, input.phase, input.at, input.usedMs)) return false;
    const facts = input.repositories.getAgentRunObservation(input.runId)!;
    recordExecutionEvent(input.repositories, { ...facts, id: `${input.runId}:stop`, type: "execution_stop_requested",
      runId: input.runId, reason: input.reason, phase: input.phase, observedAt: input.at,
      budget: executionBudgetFacts(input.repositories, input.runId) });
    return true;
  });
}
