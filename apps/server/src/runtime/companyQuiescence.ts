import type {
  FinalFounderReportClassification,
  FounderDecision,
  HumanAction,
  KeyResult,
  Task,
  WaitState,
} from "@auto-crop/core";

/**
 * The near horizon for "a Wait State that still counts as scheduled work". A tuned constant — start
 * at 72 hours ("no check-in within 3 days"). Tests must assert only the two sides of this boundary,
 * never the exact value.
 */
export const QUIESCENCE_WAIT_HORIZON_MS = 72 * 60 * 60 * 1_000;

/** Task statuses that mean the runtime still has a forward move for that task. */
const ACTIVE_TASK_STATUSES: ReadonlySet<Task["status"]> = new Set([
  "queued",
  "waiting_dependency",
  "running",
  "retrying",
  "needs_replan",
]);

/**
 * Task statuses with no forward move at all — the "terminal state" an Objective Stage Change waits
 * for. `review` and `needs_replan` are deliberately excluded: a task in either still has a next move
 * (manual review, an open replan).
 */
const TERMINAL_TASK_STATUSES: ReadonlySet<Task["status"]> = new Set([
  "complete",
  "blocked",
  "failed",
  "cancelled",
]);

/** True when a task has reached a state the runtime will not move it out of on its own. */
export function isTerminalTaskStatus(status: Task["status"]): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

export type CompanyQuiescenceInput = {
  tasks: Task[];
  waitStates: WaitState[];
  humanActions: HumanAction[];
  founderDecisions: FounderDecision[];
  now?: () => Date;
};

/**
 * Task ids that wait on the founder, not the runtime: the task that surfaced a still-pending Human
 * Action or Founder Decision, and the downstream tasks it blocks.
 */
function founderParkedTaskIds(input: CompanyQuiescenceInput): Set<string> {
  return new Set([
    ...input.humanActions
      .filter((action) => action.status === "pending")
      .flatMap((action) => [action.taskId, ...action.blockedTaskIds]),
    ...input.founderDecisions
      .filter((decision) => decision.status === "pending")
      .flatMap((decision) => [decision.taskId, ...decision.blockedTaskIds]),
  ]);
}

/**
 * Company Quiescence: the company has no forward move left. Computed, never persisted. True when no
 * task is `queued` / `running` / `waiting_dependency` / `retrying` / `needs_replan` (unless that task
 * is only parked on the founder), no Wait State checks in within the near horizon, and every
 * remaining task is terminal or parked on a pending Human Action or Founder Decision.
 */
export function isCompanyQuiescent(input: CompanyQuiescenceInput): boolean {
  const parkedTaskIds = founderParkedTaskIds(input);

  const hasRuntimeForwardMove = input.tasks.some(
    (task) => ACTIVE_TASK_STATUSES.has(task.status) && !parkedTaskIds.has(task.id),
  );
  if (hasRuntimeForwardMove) {
    return false;
  }

  const nowMs = (input.now ?? (() => new Date()))().getTime();
  const horizonMs = nowMs + QUIESCENCE_WAIT_HORIZON_MS;
  const hasNearHorizonWaitState = input.waitStates.some((waitState) => {
    if (waitState.status === "ready_for_check_in") {
      return true;
    }
    const checkAtMs = Date.parse(waitState.nextCheckAt);
    return Number.isFinite(checkAtMs) && checkAtMs <= horizonMs;
  });
  if (hasNearHorizonWaitState) {
    return false;
  }

  // A task left in `review` still has a forward move (manual CEO review) unless it too is only
  // waiting on the founder.
  const hasUnparkedReviewTask = input.tasks.some(
    (task) => task.status === "review" && !parkedTaskIds.has(task.id),
  );
  if (hasUnparkedReviewTask) {
    return false;
  }

  return true;
}

/**
 * Classify the outcome the Final Founder Report should carry: `achieved` when the key results are
 * met; else `waiting` when the founder can still act (open Wait States beyond the horizon, pending
 * Human Actions, pending Founder Decisions); else `stalled` — the goals are unmet and nothing is
 * going to move without new work.
 */
export function classifyFinalFounderReport(input: {
  keyResults: KeyResult[];
  waitStates: WaitState[];
  humanActions: HumanAction[];
  founderDecisions: FounderDecision[];
}): FinalFounderReportClassification {
  const allKeyResultsMet =
    input.keyResults.length > 0 && input.keyResults.every((keyResult) => keyResult.status === "met");
  if (allKeyResultsMet) {
    return "achieved";
  }

  const hasOpenFounderItems =
    input.waitStates.length > 0 ||
    input.humanActions.some((action) => action.status === "pending") ||
    input.founderDecisions.some((decision) => decision.status === "pending");
  if (hasOpenFounderItems) {
    return "waiting";
  }

  return "stalled";
}
