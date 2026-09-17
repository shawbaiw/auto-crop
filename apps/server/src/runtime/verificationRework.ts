import {
  MAX_VERIFICATION_ROUNDS,
  type ArtifactVerification,
  type BusinessArtifact,
  type Task,
  type TaskEvent,
  type TaskHoldKind,
  type VerificationRework,
  type VerificationReworkDecision,
} from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { applyTaskTransition } from "./taskTransition";

type Repositories = ReturnType<typeof createRepositories>;

/**
 * Holds a producer can be reworked out of: its delivery was waiting on its parent or on CEO review, and
 * the verdict answers that wait. Anything else — a Founder Decision, an approval — is not the verifier's
 * to override, so the failure escalates instead.
 */
const REWORKABLE_PRODUCER_HOLDS: readonly TaskHoldKind[] = ["awaiting_parent_aggregation", "awaiting_ceo_review"];

export type VerificationReworkResult = {
  rework: VerificationRework;
  /** The verifier after the decision was applied. */
  verifier: Task;
  events: TaskEvent[];
};

/**
 * Decide and apply what happens after a verdict that did not pass (ADR 0026).
 *
 * The budget belongs to the verifying task: every failed report is one round, recorded once however
 * often it is finalized, and nothing but a replan — which makes a new verifying task — starts a new
 * budget. Rework goes to the producers the failed checks fault, as a record they read on their next
 * dispatch, never as a dependency back onto the verifier (which would be a cycle).
 *
 * Only `rework_producers` and `reverify` move anything. `escalated` and `exhausted` leave the verifier for
 * the caller to park: the verdict is not something re-running the same work can change, or the budget is
 * spent.
 */
export function applyVerificationRework(input: {
  repositories: Repositories;
  verifier: Task;
  artifact: BusinessArtifact & { verification: ArtifactVerification };
  now: () => Date;
  createId: (prefix: string) => string;
}): VerificationReworkResult {
  const { repositories, artifact, now, createId } = input;
  const existing = repositories
    .listVerificationReworksForVerifier(input.verifier.id)
    .find((rework) => rework.failedArtifactId === artifact.id);
  if (existing) {
    return { rework: existing, verifier: repositories.getTask(input.verifier.id) ?? input.verifier, events: [] };
  }

  const round = repositories.listVerificationReworksForVerifier(input.verifier.id).length + 1;
  const verification = artifact.verification;
  const failedChecks = verification.checks
    .filter((check) => check.outcome !== "passed")
    .map((check) => ({
      ...check,
      description: verification.requirements.find((requirement) => requirement.id === check.requirementId)?.description ?? check.requirementId,
    }));
  const faulted = verification.checks.filter((check) => check.outcome === "failed");
  const producerTaskIds = faulted.some((check) => !check.targetTaskId)
    ? verification.targets.map((target) => target.taskId)
    : [...new Set(faulted.map((check) => check.targetTaskId!))];
  const producers = producerTaskIds.map((id) => repositories.getTask(id)).filter((task): task is Task => task !== null);

  const decision = decide({
    round,
    verification,
    producersReworkable: producers.length > 0 && producers.every((producer) => isReworkable(repositories, producer)),
  });
  const rework: VerificationRework = {
    id: createId("verification_rework"),
    companyId: input.verifier.companyId,
    verifierTaskId: input.verifier.id,
    failedArtifactId: artifact.id,
    round,
    decision,
    producerTaskIds: decision === "rework_producers" ? producers.map((producer) => producer.id) : [],
    redeliveredTaskIds: [],
    failedChecks,
    createdAt: now().toISOString(),
  };
  repositories.recordVerificationRework(rework);

  const events: TaskEvent[] = [];
  if (decision === "rework_producers") {
    const failedIds = failedChecks.filter((check) => check.outcome === "failed").map((check) => check.requirementId).join(", ");
    for (const producer of producers) {
      const current = repositories.getCurrentBusinessArtifactForTask(producer.id);
      if (current) {
        // The delivery was judged and failed: no consumer may take it while it is being redone.
        repositories.updateBusinessArtifactReviewStatus(current.id, "returned", rework.createdAt);
      }
      const requeued = applyTaskTransition({
        repositories,
        task: producer,
        status: "queued",
        executionSummary: { latestFailureReason: null, latestFailureMessage: null, dependencyNote: null },
        resolvesHoldKinds: REWORKABLE_PRODUCER_HOLDS,
        resolution: "superseded",
        now,
        createId,
      }).task;
      events.push(appendEvent(repositories, createId, now, requeued, {
        type: "task_retrying",
        message: `Rework requested: ${input.verifier.title} failed ${failedIds} in verification round ${round} of ${MAX_VERIFICATION_ROUNDS}.`,
        status: requeued.status,
      }));
    }
    const note = `Waiting for rework of ${producers.map((producer) => producer.title).join(", ")} after verification round ${round} of ${MAX_VERIFICATION_ROUNDS} failed: ${failedIds}.`;
    const waiting = applyTaskTransition({
      repositories,
      task: input.verifier,
      status: "waiting_dependency",
      executionSummary: { latestFailureReason: null, latestFailureMessage: null, dependencyNote: note },
      hold: { kind: "awaiting_dependency_artifact", resolver: "upstream_task", subjectKind: "task", subjectId: producers[0]!.id, reason: note },
      resolvesHoldKinds: ["invalid_business_artifact", "runtime_interrupted", "verification_failed"],
      resolution: "cleared",
      now,
      createId,
    }).task;
    events.unshift(appendEvent(repositories, createId, now, waiting, { type: "dependency_waiting", message: note, status: "waiting_dependency" }));
    return { rework, verifier: waiting, events };
  }

  if (decision === "reverify") {
    const requeued = applyTaskTransition({
      repositories,
      task: input.verifier,
      status: "queued",
      executionSummary: { latestFailureReason: null, latestFailureMessage: null, dependencyNote: null },
      resolvesHoldKinds: ["invalid_business_artifact", "runtime_interrupted", "verification_failed"],
      resolution: "cleared",
      now,
      createId,
    }).task;
    events.push(appendEvent(repositories, createId, now, requeued, {
      type: "task_retrying",
      message: `Re-verifying ${input.verifier.title}: its verdict no longer covered current output (round ${round} of ${MAX_VERIFICATION_ROUNDS}).`,
      status: requeued.status,
    }));
    return { rework, verifier: requeued, events };
  }

  return { rework, verifier: repositories.getTask(input.verifier.id) ?? input.verifier, events };
}

function decide(input: {
  round: number;
  verification: ArtifactVerification;
  producersReworkable: boolean;
}): VerificationReworkDecision {
  const failed = input.verification.checks.some((check) => check.outcome === "failed");
  const notRun = input.verification.checks.some((check) => check.outcome === "not_run");
  const automatic: VerificationReworkDecision | null = failed
    ? (input.producersReworkable ? "rework_producers" : null)
    : notRun
      ? null
      : "reverify";
  if (!automatic) {
    return "escalated";
  }
  return input.round >= MAX_VERIFICATION_ROUNDS ? "exhausted" : automatic;
}

function isReworkable(repositories: Repositories, producer: Task): boolean {
  if (producer.status !== "review" && producer.status !== "complete") {
    return false;
  }
  return repositories.listOpenTaskHolds(producer.id).every((hold) => REWORKABLE_PRODUCER_HOLDS.includes(hold.kind));
}

/** Feedback for a producer's next run: every pending rework that faults it, oldest first. */
export function pendingReworkFeedback(repositories: Repositories, producer: Task): Array<{
  round: number;
  verifierTitle: string;
  failedChecks: VerificationRework["failedChecks"];
}> {
  return repositories.listPendingReworksForProducer(producer.id).map((rework) => ({
    round: rework.round,
    verifierTitle: repositories.getTask(rework.verifierTaskId)?.title ?? rework.verifierTaskId,
    failedChecks: rework.failedChecks.filter((check) => !check.targetTaskId || check.targetTaskId === producer.id),
  }));
}

/** A producer delivered again: the reworks it owed are answered. */
export function markReworkRedelivered(repositories: Repositories, producer: Task): void {
  for (const rework of repositories.listPendingReworksForProducer(producer.id)) {
    repositories.markReworkRedelivered(rework.id, producer.id);
  }
}

function appendEvent(
  repositories: Repositories,
  createId: (prefix: string) => string,
  now: () => Date,
  task: Task,
  event: { type: TaskEvent["type"]; message: string; status: TaskEvent["status"] },
): TaskEvent {
  const record: TaskEvent = {
    id: createId("task_event"),
    companyId: task.companyId,
    taskId: task.id,
    type: event.type,
    message: event.message,
    createdAt: now().toISOString(),
    status: event.status,
    failureReason: null,
    failureMessage: null,
    executionProfileName: null,
    requestedTimeoutMs: null,
    effectiveTimeoutMs: null,
    dependencyNote: task.dependencyNote ?? null,
    artifactWorkspacePath: task.artifactWorkspacePath ?? null,
  };
  repositories.appendTaskEvent(record);
  return record;
}
