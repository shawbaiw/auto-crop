import {
  resolveTaskAffordances,
  type Task,
  type TaskAffordance,
  type TaskAffordanceKind,
  type TaskHold,
} from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { reconcileTaskHoldsForTask } from "./taskHoldReconciliation";

export type TaskAffordanceState = {
  holds: TaskHold[];
  affordances: TaskAffordance[];
};

/**
 * Bind the pure affordance rules to stored facts. Every surface and every mutating route reads this
 * one function, which is what stops a button the API would reject from being rendered, and a
 * resolvable Hold from being invisible (ADR 0020).
 */
export function resolveTaskAffordanceState(
  repositories: ReturnType<typeof createRepositories>,
  task: Task,
): TaskAffordanceState {
  // Repair first: a task parked without a Hold — by a path that predates Holds or bypassed the seam
  // — must still resolve to a real way forward at the moment someone looks at it.
  const { holds } = reconcileTaskHoldsForTask(repositories, task);
  const hasProposedReplan = repositories
    .listReplanProposalsForTask(task.id)
    .some((proposal) => proposal.status === "proposed");

  return {
    holds,
    affordances: resolveTaskAffordances({ status: task.status, holds, hasProposedReplan }),
  };
}

export type AffordanceCheck =
  | { ok: true; state: TaskAffordanceState }
  | { ok: false; state: TaskAffordanceState };

/**
 * The one guard shape for "may this actor do this to this task right now".
 *
 * A refusal carries the task's current affordances rather than only a message, so a founder acting
 * on a view that has since moved on is told what they *can* do instead of being handed a dead end —
 * the failure this replaces answered a stale CEO approval with a bare "no longer waiting for review".
 */
export function checkTaskAffordance(
  repositories: ReturnType<typeof createRepositories>,
  task: Task,
  kind: TaskAffordanceKind,
): AffordanceCheck {
  const state = resolveTaskAffordanceState(repositories, task);
  const ok = state.affordances.some((affordance) => affordance.kind === kind);

  return ok ? { ok: true, state } : { ok: false, state };
}
