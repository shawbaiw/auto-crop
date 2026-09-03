import type { TaskEvent } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { evaluateAutomaticAcceptance } from "./automaticAcceptance";
import { acceptDeliverableAutomatically } from "./businessAcceptance";
import { parseOpenDecisions } from "./founderDecision";

export type ReconcileReviewTasksInput = {
  repositories: ReturnType<typeof createRepositories>;
  companyId: string;
  now?: () => Date;
  createId?: (prefix: string) => string;
  requestSchedulerWake?: () => void;
};

export type ReconcileReviewTasksResult = {
  acceptedTaskIds: string[];
  events: TaskEvent[];
};

/**
 * One-time migration pass (ADR 0017 §Migration). On the first tick after the deterministic
 * acceptance model ships to a company, re-evaluate every task currently in `review` against the
 * deterministic conditions and accept the ones that qualify through the shared business acceptance
 * seam, so the founder is not left with a queue of tasks the new model would have accepted. A
 * per-company marker in `runtime_state` records that the pass has run; every later call is a no-op.
 *
 * A qualifying acceptance carries provenance `automatic_acceptance` and, deliberately, no Task
 * Outcome Summary — no history is fabricated for work that completed before the new model. Tasks
 * that trip the risk-pattern scan or declare a kept Founder Decision stay in `review` for the
 * restructured manual panel. `complete` and `blocked` tasks are never considered — only `review`.
 *
 * Safe to run more than once before the marker is set (a crash mid-pass, concurrent callers): an
 * accepted task becomes `complete` and drops out of the `review` filter, and a task left in
 * `review` re-fails the same check, so nothing is accepted twice and no state is rewritten. No
 * company allow/deny list — the known stuck company's problem tasks are `blocked`/`failed`, not
 * `review`, so they are skipped by construction (ADR 0015 precedent).
 */
export function reconcileReviewTasksForAutomaticAcceptance(
  input: ReconcileReviewTasksInput,
): ReconcileReviewTasksResult {
  const acceptedTaskIds: string[] = [];
  const events: TaskEvent[] = [];

  if (input.repositories.hasReviewReconciliationRun(input.companyId)) {
    return { acceptedTaskIds, events };
  }

  const reviewTaskIds = input.repositories
    .listTasksForCompany(input.companyId)
    .filter((task) => task.status === "review")
    .map((task) => task.id);

  for (const taskId of reviewTaskIds) {
    // Re-read: an earlier acceptance in this same pass may have cascaded into this task.
    const task = input.repositories.getTask(taskId);
    if (!task || task.status !== "review") {
      continue;
    }

    const artifact = input.repositories.getCurrentBusinessArtifactForTask(task.id);
    if (evaluateAutomaticAcceptance({ task, artifact }).kind !== "accept") {
      continue;
    }
    if (parseOpenDecisions(artifact!.payload).kept.length > 0) {
      continue;
    }

    const accepted = acceptDeliverableAutomatically({
      repositories: input.repositories,
      task,
      artifact: artifact!,
      eventMessage: `Automatic Acceptance reconciled task: ${task.title}.`,
      outcomeSummaryText: null,
      requestSchedulerWake: input.requestSchedulerWake,
      now: input.now,
      createId: input.createId,
    });

    acceptedTaskIds.push(task.id);
    events.push(...accepted.events);
  }

  input.repositories.markReviewReconciliationRun(
    input.companyId,
    (input.now ?? (() => new Date()))().toISOString(),
  );

  return { acceptedTaskIds, events };
}
