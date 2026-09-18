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
import { dependenciesWithRole } from "./verificationContract";

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
  // Atomic on its own as well as inside delivery finalization: a record whose actions did not happen
  // would be read as a round already handled, leaving the rework half-applied for good.
  return input.repositories.transaction(() => applyVerificationReworkWithinTransaction(input));
}

function applyVerificationReworkWithinTransaction(input: {
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
  // A check that names no target faults every target: the runtime cannot tell which one was at fault.
  const faultedTargets = faulted.some((check) => !check.targetTaskId)
    ? verification.targets
    : verification.targets.filter((target) => faulted.some((check) => check.targetTaskId === target.taskId));
  // A verdict about a version that has since been superseded says nothing about the current one. Its
  // failure must not send the new version back; the current output is verified again instead.
  const supersededTargets = faultedTargets.filter(
    (target) => repositories.getCurrentBusinessArtifactForTask(target.taskId)?.id !== target.artifactId,
  );
  const chains = faultedTargets.map((target) => ({ target, chain: resolveReworkChain(repositories, target.taskId) }));
  const reworkable = chains.length > 0
    && supersededTargets.length === 0
    && chains.every((entry) => entry.chain !== null && entry.chain.requeue.every((task) => isReworkable(repositories, task)));

  const decision = decide({
    round,
    verification,
    supersededTargets: supersededTargets.length > 0,
    reworkable,
  });
  const requeueTasks = decision === "rework_producers"
    ? [...new Map(chains.flatMap((entry) => entry.chain!.requeue).map((task) => [task.id, task])).values()]
    : [];
  const rework: VerificationRework = {
    id: createId("verification_rework"),
    companyId: input.verifier.companyId,
    verifierTaskId: input.verifier.id,
    failedArtifactId: artifact.id,
    round,
    decision,
    producerTaskIds: requeueTasks.map((task) => task.id),
    redeliveredTaskIds: [],
    failedChecks,
    createdAt: now().toISOString(),
  };
  repositories.recordVerificationRework(rework);

  const events: TaskEvent[] = [];
  if (decision === "rework_producers") {
    const failedIds = failedChecks.filter((check) => check.outcome === "failed").map((check) => check.requirementId).join(", ");
    const reworkMessage = `Rework requested: ${input.verifier.title} failed ${failedIds} in verification round ${round} of ${MAX_VERIFICATION_ROUNDS}.`;
    for (const { target, chain } of chains) {
      // Only the version the verdict judged is returned; a producer that has moved on keeps its current
      // delivery.
      returnJudgedArtifact(repositories, target.taskId, target.artifactId, rework.createdAt);
      for (const task of chain!.reverify) {
        parkForRework(repositories, task, chain!.requeue[0]!, `Re-verifying after rework of ${chain!.requeue.map((item) => item.title).join(", ")}.`, now, createId);
      }
      for (const task of chain!.park) {
        parkForRework(repositories, task, chain!.requeue[0]!, `Waiting for its department to rework ${chain!.requeue.map((item) => item.title).join(", ")}.`, now, createId);
      }
    }
    for (const task of requeueTasks) {
      returnJudgedArtifact(repositories, task.id, repositories.getCurrentBusinessArtifactForTask(task.id)?.id ?? null, rework.createdAt);
      const requeued = applyTaskTransition({
        repositories,
        task,
        status: "queued",
        executionSummary: { latestFailureReason: null, latestFailureMessage: null, dependencyNote: null },
        resolvesHoldKinds: REWORKABLE_PRODUCER_HOLDS,
        resolution: "superseded",
        now,
        createId,
      }).task;
      events.push(appendEvent(repositories, createId, now, requeued, { type: "task_retrying", message: reworkMessage, status: requeued.status }));
    }
    const note = `Waiting for rework of ${faultedTargets.map((target) => repositories.getTask(target.taskId)?.title ?? target.taskId).join(", ")} after verification round ${round} of ${MAX_VERIFICATION_ROUNDS} failed: ${failedIds}.`;
    const waiting = applyTaskTransition({
      repositories,
      task: input.verifier,
      status: "waiting_dependency",
      executionSummary: { latestFailureReason: null, latestFailureMessage: null, dependencyNote: note },
      hold: { kind: "awaiting_dependency_artifact", resolver: "upstream_task", subjectKind: "task", subjectId: faultedTargets[0]!.taskId, reason: note },
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
      message: supersededTargets.length > 0
        ? `Re-verifying ${input.verifier.title}: its verdict judged output that has since been superseded (round ${round} of ${MAX_VERIFICATION_ROUNDS}).`
        : `Re-verifying ${input.verifier.title}: its verdict no longer covered current output (round ${round} of ${MAX_VERIFICATION_ROUNDS}).`,
      status: requeued.status,
    }));
    return { rework, verifier: requeued, events };
  }

  return { rework, verifier: repositories.getTask(input.verifier.id) ?? input.verifier, events };
}

/**
 * Where a target's rework actually goes.
 *
 * A target its department split into subtasks is not redone by re-running the parent: the parent works in
 * its execute stage's workspace, so re-running it would change the files an internal verdict already
 * passed on without that verdict being taken again. The rework goes to the stages that produce the
 * output, their internal verifier is set up to verify the new output, and the parent waits to aggregate
 * again — so every verdict keeps describing the output it checked (ADR 0026).
 */
function resolveReworkChain(
  repositories: Repositories,
  producerTaskId: string,
): { requeue: Task[]; reverify: Task[]; park: Task[] } | null {
  const producer = repositories.getTask(producerTaskId);
  if (!producer) {
    return null;
  }
  const subtasks = repositories
    .listTaskDependencies(producer.id)
    .map((dependency) => repositories.getTask(dependency.dependsOnTaskId))
    .filter((task): task is Task => task?.parentTaskId === producer.id);
  const internalVerifiers = subtasks.filter(
    (subtask) => dependenciesWithRole(repositories, subtask.id, "verification_target").length > 0,
  );
  const internalTargets = [...new Map(
    internalVerifiers
      .flatMap((verifier) => dependenciesWithRole(repositories, verifier.id, "verification_target"))
      .map((dependency) => repositories.getTask(dependency.dependsOnTaskId))
      .filter((task): task is Task => task?.parentTaskId === producer.id)
      .map((task) => [task.id, task]),
  ).values()];

  if (internalTargets.length === 0) {
    return { requeue: [producer], reverify: [], park: [] };
  }
  return { requeue: internalTargets, reverify: internalVerifiers, park: [producer] };
}

/** Return the delivery a verdict judged, and only that one. */
function returnJudgedArtifact(repositories: Repositories, taskId: string, artifactId: string | null, at: string): void {
  const current = repositories.getCurrentBusinessArtifactForTask(taskId);
  if (current && current.id === artifactId && current.reviewStatus !== "returned") {
    repositories.updateBusinessArtifactReviewStatus(current.id, "returned", at);
  }
}

/** Park a task that must wait for a rework it does not perform itself: an internal verifier, or a parent. */
function parkForRework(
  repositories: Repositories,
  task: Task,
  waitsOn: Task,
  reason: string,
  now: () => Date,
  createId: (prefix: string) => string,
): void {
  applyTaskTransition({
    repositories,
    task,
    status: "waiting_dependency",
    executionSummary: { latestFailureReason: null, latestFailureMessage: null, dependencyNote: reason },
    hold: { kind: "awaiting_dependency_artifact", resolver: "upstream_task", subjectKind: "task", subjectId: waitsOn.id, reason },
    resolvesHoldKinds: ["awaiting_parent_aggregation", "awaiting_ceo_review", "verification_failed"],
    resolution: "superseded",
    now,
    createId,
  });
}

function decide(input: {
  round: number;
  verification: ArtifactVerification;
  supersededTargets: boolean;
  reworkable: boolean;
}): VerificationReworkDecision {
  const failed = input.verification.checks.some((check) => check.outcome === "failed");
  const notRun = input.verification.checks.some((check) => check.outcome === "not_run");
  const automatic: VerificationReworkDecision | null = failed
    // A failure on a superseded version is not evidence against the current one, whatever it says.
    ? (input.supersededTargets ? "reverify" : input.reworkable ? "rework_producers" : null)
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
