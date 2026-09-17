import {
  deriveTaskHold,
  isHeldTaskStatus,
  isTaskHoldStranded,
  localizedTextFromString,
  type Task,
  type TaskHold,
} from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { resolveDependencyReadiness } from "./dependencyReadiness";

export type ReconcileTaskHoldsInput = {
  repositories: ReturnType<typeof createRepositories>;
  companyId: string;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export type TaskHoldRepair =
  | { kind: "opened"; taskId: string; hold: TaskHold }
  | { kind: "resolved"; taskId: string; holds: TaskHold[] };

export type ReconcileTaskHoldsResult = {
  repairs: TaskHoldRepair[];
};

/**
 * Restore the Task Hold invariant across a company's tasks: parked tasks have an open Hold, moving
 * and finished tasks have none (ADR 0020).
 *
 * `applyTaskTransition` already keeps both true for every transition that goes through it. This pass
 * is the standing net underneath it, and it is the part that makes the model robust rather than
 * merely correct-by-convention. It runs on every company-state read and repairs, from current facts
 * alone:
 *
 * - tasks parked before Holds existed, which carry no Hold at all;
 * - tasks parked by a future code path that bypasses the seam or forgets to declare a Hold;
 * - Holds left open on a task that has since moved on, whatever moved it.
 *
 * Deliberately not a one-time migration with a marker (unlike `reviewReconciliation`): the drift it
 * repairs is not a one-time schema change but a class of mistake that can recur, so the repair has
 * to be standing. It is idempotent — a company already satisfying the invariant produces no repairs
 * and no writes — and it never invents a resolution, only an owner: a task nobody can move is worse
 * than a task whose Hold names a vaguer reason than the original code would have.
 */
export function reconcileTaskHolds(input: ReconcileTaskHoldsInput): ReconcileTaskHoldsResult {
  const repairs: TaskHoldRepair[] = [];

  for (const task of input.repositories.listTasksForCompany(input.companyId)) {
    repairs.push(...reconcileTaskHoldsForTask(input.repositories, task, input.now, input.createId).repairs);
  }

  return { repairs };
}

/**
 * The same repair for one task, applied wherever a task's Holds are read rather than only on a
 * company-state read. Reading affordances is the moment the invariant has to be true — a founder can
 * act on a task without loading the board first — so the repair belongs at that read, not on a
 * separate sweep that may not have run yet.
 */
export function reconcileTaskHoldsForTask(
  repositories: ReturnType<typeof createRepositories>,
  task: Task,
  nowFn?: () => Date,
  createIdFn?: (prefix: string) => string,
): { holds: TaskHold[]; repairs: TaskHoldRepair[] } {
  const now = nowFn ?? (() => new Date());
  const createId = createIdFn ?? defaultCreateId;
  const timestamp = now().toISOString();
  const repairs: TaskHoldRepair[] = [];
  let openHolds = repositories.listOpenTaskHolds(task.id);

  if (!isHeldTaskStatus(task.status)) {
    if (openHolds.length > 0) {
      const resolved = repositories.resolveOpenTaskHolds(task.id, "superseded", timestamp);
      repairs.push({ kind: "resolved", taskId: task.id, holds: resolved });
    }
    return { holds: [], repairs };
  }

  const stale = openHolds.filter((hold) => isTaskHoldStranded(hold.kind, task.status));
  if (stale.length > 0) {
    const resolved = repositories.resolveOpenTaskHolds(
      task.id,
      "superseded",
      timestamp,
      stale.map((hold) => hold.kind),
    );
    repairs.push({ kind: "resolved", taskId: task.id, holds: resolved });
    openHolds = openHolds.filter((hold) => !stale.includes(hold));
  }

  if (openHolds.length > 0) {
    return { holds: openHolds, repairs };
  }

  const derived = deriveTaskHold({
    status: task.status,
    taskKind: task.taskKind,
    failureReason: task.latestFailureReason,
    dependencyNote: task.dependencyNote,
  });
  if (!derived) {
    return { holds: openHolds, repairs };
  }

  const refined = refineWithDependencyFacts(repositories, task, derived);
  const reason = task.latestFailureMessage
    ?? task.dependencyNote
    ?? refined.reason
    ?? `${task.title} is stopped in ${task.status} and needs a decision to continue.`;
  const hold: TaskHold = {
    id: createId("task_hold"),
    companyId: task.companyId,
    taskId: task.id,
    kind: refined.kind,
    resolver: refined.resolver,
    subjectKind: refined.subjectId ? "task" : null,
    subjectId: refined.subjectId ?? null,
    reason,
    reasonText: localizedTextFromString(reason),
    openedAt: timestamp,
    resolvedAt: null,
    resolution: null,
  };
  repositories.openTaskHold(hold);
  repairs.push({ kind: "opened", taskId: task.id, hold });

  return { holds: [hold], repairs };
}

/**
 * Sharpen the unattributed fallback using facts `deriveTaskHold` cannot see.
 *
 * `runtime_interrupted` means "stopped, reason unknown", and its way out is to re-run the work. But
 * a task stopped with an upstream that still owes a deliverable is not an unknown interruption at
 * all — it is an ordinary dependency wait, and telling the founder to re-run it would be wrong.
 * Only the repository can tell the two apart, so the refinement lives here rather than in the pure
 * rule, and it only ever narrows the fallback — an attributed Hold is left exactly as derived.
 */
function refineWithDependencyFacts(
  repositories: ReturnType<typeof createRepositories>,
  task: Task,
  derived: { kind: TaskHold["kind"]; resolver: TaskHold["resolver"] },
): { kind: TaskHold["kind"]; resolver: TaskHold["resolver"]; subjectId?: string; reason?: string } {
  if (derived.kind !== "runtime_interrupted" || repositories.listTaskDependencies(task.id).length === 0) {
    return derived;
  }

  const readiness = resolveDependencyReadiness(repositories, task);
  if (readiness.kind === "ready") {
    return derived;
  }

  if (readiness.kind === "waiting" && readiness.waitingOnDecision) {
    return {
      kind: "awaiting_founder_decision",
      resolver: "founder",
      subjectId: readiness.founderDecisionId ?? undefined,
      reason: readiness.note,
    };
  }

  return {
    kind: "awaiting_dependency_artifact",
    resolver: "upstream_task",
    subjectId: readiness.dependency.id,
    reason: readiness.note,
  };
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
