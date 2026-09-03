import type { TaskEvent } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { evaluateAutomaticAcceptance } from "./automaticAcceptance";
import { acceptTaskBusinessArtifact } from "./businessAcceptance";
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
 * One-time, idempotent migration pass (ADR 0017 §Migration). Re-evaluates every task currently in
 * `review` against the deterministic acceptance conditions and accepts the ones that qualify through
 * the shared business acceptance seam, so shipping the new model does not leave the founder with a
 * queue of tasks it would have accepted.
 *
 * A qualifying acceptance carries provenance `automatic_acceptance` and, deliberately, no Task
 * Outcome Summary — no history is fabricated for work that completed before the new model. Tasks
 * that trip the risk-pattern scan or declare a kept Founder Decision stay in `review` for the
 * restructured manual panel. `complete` and `blocked` tasks are never considered — only `review`.
 *
 * Idempotent by construction: an accepted task becomes `complete` and drops out of the `review`
 * filter on any re-run; a task left in `review` re-fails the same check and is skipped again. The
 * pass writes nothing for a task it does not accept. No company allow/deny list — the known stuck
 * company's problem tasks are `blocked`/`failed`, not `review`, so they are skipped by construction
 * (ADR 0015 precedent).
 */
export function reconcileReviewTasksForAutomaticAcceptance(
  input: ReconcileReviewTasksInput,
): ReconcileReviewTasksResult {
  const acceptedTaskIds: string[] = [];
  const events: TaskEvent[] = [];

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

    const accepted = acceptTaskBusinessArtifact({
      repositories: input.repositories,
      task,
      artifact: artifact!,
      acceptanceProvenance: "automatic_acceptance",
      eventType: "automatic_acceptance",
      eventMessage: `Automatic Acceptance reconciled task: ${task.title}.`,
      outcomeSummaryText: null,
      keyResultProgress: { currentValue: "accepted_business_artifact", status: "met" },
      dependencyCascade: { maxDepth: 2 },
      requestSchedulerWake: input.requestSchedulerWake,
      now: input.now,
      createId: input.createId,
    });

    acceptedTaskIds.push(task.id);
    events.push(accepted.event);
    for (const update of accepted.dependencyCascade?.updatedTasks ?? []) {
      if (update.event) {
        events.push(update.event);
      }
    }
  }

  return { acceptedTaskIds, events };
}
