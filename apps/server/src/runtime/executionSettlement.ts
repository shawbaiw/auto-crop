import { isBudgetExhaustion } from "./budgetPolicy";
import { executionBudgetFacts } from "./budgetStop";
import type { AgentFailureReason, AgentRun } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { recordExecutionEvent } from "./executionEvents";

type Repositories = ReturnType<typeof createRepositories>;
export type RunOutcome = {
  status: AgentRun["status"];
  failureReason?: AgentFailureReason;
  failureMessage?: string;
  terminationConfirmed?: boolean | null;
  /** Only supplied by the owning monotonic meter; absence settles the reservation conservatively. */
  budgetUsedMs?: number;
  budgetCheck?: () => number | undefined;
};

/** Claim must be the first SQL statement, so competing SQLite writers cannot upgrade a stale read.
 * Commit contains only synchronous database writes, including claim changes and the outbox record.
 * Subscribers and filesystem publication run after this returns, only for the winner.
 */
export function settleExecution(repositories: Repositories, claim: () => boolean, commit: () => void): boolean {
  return repositories.transaction(() => {
    if (!claim()) return false;
    commit();
    return true;
  });
}

export function settleAgentRun(input: {
  repositories: Repositories;
  runId: string;
  outcome: RunOutcome;
  at: string;
  createId: (prefix: string) => string;
  expectedTaskStatus?: "running" | "retrying";
  expectedOwnerId?: string;
  commit: () => void;
}): boolean {
  const { repositories, runId, outcome } = input;
  return settleExecution(repositories, () => repositories.updateAgentRunStatus(runId, outcome.status, input.at, {
    failureReason: outcome.failureReason,
    failureMessage: outcome.failureMessage,
    expectedStatus: "running",
    expectedTaskStatus: input.expectedTaskStatus,
    expectedOwnerId: input.expectedOwnerId,
    requireCurrentEpoch: true,
  }), () => {
    input.commit();
    const usedMs = outcome.budgetCheck ? outcome.budgetCheck() : outcome.budgetUsedMs;
    repositories.executionBudget.settle(runId, input.at, outcome.terminationConfirmed === false ? undefined : usedMs);
    if (outcome.failureReason === "clock_untrusted") repositories.executionBudget.blockOwner(runId, input.at);
    const observed = repositories.getAgentRunObservation(runId);
    if (!observed) throw new Error(`Missing settlement observation for ${runId}`);
    repositories.releaseTaskLockForRun(observed.taskId, runId, observed.ownerEpoch === null);
    const budget = executionBudgetFacts(repositories, runId);
    recordExecutionEvent(repositories, {
      budget,
      ...observed,
      id: input.createId("outbox_event"),
      type: outcome.status === "complete" ? "execution_completed"
        : outcome.status !== "cancelled" && (isBudgetExhaustion(outcome.failureReason) || isBudgetExhaustion(budget?.stopReason))
          ? "execution_budget_exhausted" : "execution_failed",
      runId,
      reason: outcome.failureReason ?? null,
      observedAt: input.at,
      terminationConfirmed: outcome.terminationConfirmed ?? null,
    });
  });
}
