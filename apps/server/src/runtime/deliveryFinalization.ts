import {
  isVerificationSatisfied,
  MAX_VERIFICATION_ROUNDS,
  type BusinessArtifact,
  type Task,
  type TaskCompletionOutcome,
  type TaskEvent,
  type TaskHoldKind,
  type TaskProgressEvent,
  type TaskStatus,
} from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { evaluateAutomaticAcceptance } from "./automaticAcceptance";
import { acceptDeliverableAutomatically } from "./businessAcceptance";
import { refreshDependencyTasks } from "./dependencyCascade";
import { parseOpenDecisions, type FounderDecisionDeclaration } from "./founderDecision";
import { recordTaskCompletionEvent } from "./taskCompletion";
import { applyTaskTransition } from "./taskTransition";
import { verificationFailureMessage } from "./verificationContract";
import { applyVerificationRework, markReworkRedelivered } from "./verificationRework";

type Repositories = ReturnType<typeof createRepositories>;

/**
 * Where a delivered, well-formed artifact leaves its task.
 *
 * - `held` — something the delivery does not answer (an approval, a Human Action, an upstream) still
 *   holds the task; it stays where it is.
 * - `verification_rework` — a verifier's verdict is not `passed`, and the runtime sent the work back for
 *   rework or re-verification within the round budget.
 * - `verification_failed` — a verifier's verdict is not `passed`, and no automatic path is left.
 * - `awaiting_founder_decision` — the artifact declares a Founder Decision.
 * - `internal_delivery` — a department subtask delivered to its parent and siblings.
 * - `accepted` — Automatic Acceptance accepted it.
 * - `awaiting_ceo_review` — the risk scan routed it to CEO Office.
 */
export type DeliveryOutcome =
  | "held"
  | "verification_rework"
  | "verification_failed"
  | "awaiting_founder_decision"
  | "internal_delivery"
  | "accepted"
  | "awaiting_ceo_review";

export type FinalizeDeliveryResult = {
  outcome: DeliveryOutcome;
  task: Task;
  /** Every task event appended, in order. Callers emit them. May be empty when the outcome has no event of its own. */
  events: TaskEvent[];
  progressEvent: TaskProgressEvent | null;
};

/**
 * Holds a delivery itself answers: the task had stopped because no reviewable artifact existed, or for
 * an unattributed reason, and now one does. Anything else was not answered by finding output.
 */
const HOLDS_ANSWERED_BY_DELIVERY: readonly TaskHoldKind[] = ["invalid_business_artifact", "runtime_interrupted"];

/**
 * Decide what a delivered artifact means for its task — the one policy for every path that delivers:
 * an Agent Run finishing, and proof recovered from a workspace. Two copies of this decision are how a
 * recovered subtask once skipped its Founder Decision and let its siblings consume an unmade choice.
 *
 * The artifact must already be valid; the caller handles invalid ones, whose recovery rules differ by
 * path. The order is deliberate: blocking Holds the delivery does not answer keep the task where it is;
 * a failed verdict comes next; for an ordinary task a risk-pattern hit outranks a declared decision; a
 * declared decision outranks internal delivery; and a subtask never reaches acceptance at all
 * (ADR 0023, ADR 0024).
 */
export function finalizeDelivery(input: FinalizeDeliveryInput): FinalizeDeliveryResult {
  // One unit of work: a delivery that fails halfway through leaves no half-applied acceptance, Hold or
  // rework record, and the caller's retry starts from the same facts (ADR 0026).
  return input.repositories.transaction(() => finalizeDeliveryWithinTransaction(input));
}

type FinalizeDeliveryInput = {
  repositories: Repositories;
  task: Task;
  artifact: BusinessArtifact;
  /** How this delivery arrived; shapes event types and wording only, never the outcome. */
  source: "agent_run" | "proof_recovery";
  now?: () => Date;
  createId?: (prefix: string) => string;
};

function finalizeDeliveryWithinTransaction(input: FinalizeDeliveryInput): FinalizeDeliveryResult {
  const { repositories, artifact, source } = input;
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const context = { repositories, now, createId };

  // Idempotent: a delivery that was already accepted is settled. Finalizing it again must not read the
  // now-accepted artifact as unreviewed work and park a complete task back in review.
  const current = repositories.getTask(input.task.id) ?? input.task;
  const storedArtifact = repositories.getCurrentBusinessArtifactForTask(current.id);
  if (current.status === "complete" && storedArtifact?.id === artifact.id && storedArtifact.reviewStatus === "accepted") {
    return { outcome: "accepted", task: current, events: [], progressEvent: null };
  }

  repositories.resolveOpenTaskHolds(input.task.id, "cleared", now().toISOString(), HOLDS_ANSWERED_BY_DELIVERY);
  const task = repositories.getTask(input.task.id) ?? input.task;

  const blocking = repositories.listOpenTaskHolds(task.id);
  if (blocking.length > 0) {
    const kinds = [...new Set(blocking.map((hold) => hold.kind))].join(", ");
    const event = appendEvent(context, task, {
      type: source === "proof_recovery" ? "proof_recovered" : "task_warning",
      message: `Delivery recorded for ${task.title}, but it stays held by: ${kinds}.`,
      status: task.status,
    });
    return { outcome: "held", task, events: [event], progressEvent: null };
  }

  // This delivery answers any rework a verifier asked of this task.
  markReworkRedelivered(repositories, task);

  if (artifact.verification && !isVerificationSatisfied(artifact)) {
    const rework = applyVerificationRework({
      repositories,
      verifier: task,
      artifact: { ...artifact, verification: artifact.verification },
      now,
      createId,
    });
    if (rework.rework.decision === "rework_producers" || rework.rework.decision === "reverify") {
      const progressEvent = appendProgress(context, rework.verifier, {
        step: "executing",
        status: "current",
        label: rework.rework.decision === "rework_producers" ? "Verification failed; rework requested" : "Re-verifying current output",
        detail: verificationFailureMessage(task, artifact.verification),
      });
      return { outcome: "verification_rework", task: rework.verifier, events: rework.events, progressEvent };
    }

    // No automatic path left: a check that could not be run, a producer held by something the verdict
    // does not answer, or the round budget spent. Only a replan starts a new budget.
    const exhausted = rework.rework.decision === "exhausted";
    const failure = exhausted
      ? `${verificationFailureMessage(task, artifact.verification)} Verification failed in ${rework.rework.round} of ${MAX_VERIFICATION_ROUNDS} rounds; a replan is required.`
      : verificationFailureMessage(task, artifact.verification);
    const parked = applyTaskTransition({
      repositories,
      task,
      status: "blocked",
      executionSummary: { latestFailureReason: "verification_failed", latestFailureMessage: failure, dependencyNote: null },
      hold: exhausted
        ? { kind: "recovery_exhausted", resolver: "founder", subjectKind: "business_artifact", subjectId: artifact.id, reason: failure }
        : { kind: "verification_failed", resolver: "runtime", subjectKind: "business_artifact", subjectId: artifact.id, reason: failure },
      now,
      createId,
    }).task;
    const event = appendEvent(context, parked, {
      type: "task_blocked",
      message: failure,
      status: "blocked",
      failureReason: "verification_failed",
      failureMessage: failure,
    });
    const progressEvent = appendProgress(context, parked, { step: "blocked", status: "blocked", label: "Verification did not pass", detail: failure });
    recordCompletionOnce(context, parked, artifact, "blocked", {
      dependencyImpact: { reason: "verification_failed" },
    });
    return { outcome: "verification_failed", task: parked, events: [event], progressEvent };
  }

  const internal = (task.taskKind ?? "parent") === "department_subtask";
  // For an ordinary task a risk-pattern hit outranks a declared decision: CEO Office sees the delivery
  // first. A subtask is never scanned — it is not being accepted (ADR 0024).
  const routedToCeoReview = !internal && evaluateAutomaticAcceptance({ task, artifact }).kind !== "accept";
  const locale = repositories.getCompany(task.companyId)?.locale ?? "en";
  const founderDecisions = parseOpenDecisions(artifact.payload, locale).kept;
  if (!routedToCeoReview && founderDecisions.length > 0) {
    // Parked in `review` but owned by the founder: the Hold says so, which is why neither CEO Office
    // nor a consumer — sibling or downstream — may treat the delivery as settled.
    const parked = applyTaskTransition({
      repositories,
      task,
      status: "review",
      executionSummary: { latestFailureReason: null, latestFailureMessage: null, dependencyNote: null },
      hold: {
        kind: "awaiting_founder_decision",
        resolver: "founder",
        subjectKind: "business_artifact",
        subjectId: artifact.id,
        reason: `${task.title} declares a Founder Decision that must be made before it can be accepted.`,
      },
      now,
      createId,
    }).task;
    recordCompletionOnce(context, parked, artifact, "awaiting_founder_decision", { founderDecisions });
    // No `task_review` event on a run: that event means CEO review, and this delivery is the founder's.
    const events = source === "proof_recovery"
      ? [appendEvent(context, parked, { type: "proof_recovered", message: `${task.title} is waiting for a Founder Decision.`, status: "review" })]
      : [];
    const progressEvent = appendProgress(context, parked, { step: "awaiting_review", status: "current", label: "Awaiting founder decision" });
    return { outcome: "awaiting_founder_decision", task: parked, events, progressEvent };
  }

  if (internal) {
    const parked = applyTaskTransition({
      repositories,
      task,
      status: "review",
      executionSummary: { latestFailureReason: null, latestFailureMessage: null, dependencyNote: null },
      hold: {
        kind: "awaiting_parent_aggregation",
        resolver: "runtime",
        subjectKind: "task",
        subjectId: task.parentTaskId ?? null,
        reason: `${task.title} is delivered and waiting for its parent task to aggregate it.`,
      },
      now,
      createId,
    }).task;
    const event = appendEvent(context, parked, {
      type: source === "proof_recovery" ? "proof_recovered" : "task_review",
      message: `Department subtask delivered: ${task.title}.`,
      status: "review",
    });
    const progressEvent = appendProgress(context, parked, {
      step: "complete",
      status: "complete",
      label: "Delivered to the department",
      detail: `Business artifact ${artifact.id}`,
    });
    // Siblings are re-evaluated here; the parent is left to its aggregation, which owns its events.
    const siblings = repositories
      .listDependencyConsumers(task.id)
      .filter((consumer) => consumer.parentTaskId === task.parentTaskId && consumer.id !== task.parentTaskId);
    const cascade = refreshDependencyTasks({ repositories, tasks: siblings, now, createId });
    const cascadeEvents = cascade.updatedTasks.flatMap((update) => (update.event ? [update.event] : []));
    return { outcome: "internal_delivery", task: parked, events: [event, ...cascadeEvents], progressEvent };
  }

  if (!routedToCeoReview) {
    const accepted = acceptDeliverableAutomatically({
      repositories,
      task,
      artifact,
      eventMessage: source === "proof_recovery"
        ? `Automatic Acceptance accepted recovered proof: ${task.title}.`
        : `Automatic Acceptance accepted task: ${task.title}.`,
      requestSchedulerWake: () => undefined,
      now,
      createId,
    });
    const progressEvent = accepted.acceptance.alreadyAccepted
      ? null
      : appendProgress(context, accepted.acceptance.task, { step: "complete", status: "complete", label: "Automatically accepted" });
    return {
      outcome: "accepted",
      task: repositories.getTask(task.id) ?? accepted.acceptance.task,
      events: accepted.events,
      progressEvent,
    };
  }

  // The Hold opened here is what CEO Office reads to offer the decision, and what the approve/return
  // guard checks. One fact, so the offer and the guard cannot disagree.
  const parked = applyTaskTransition({
    repositories,
    task,
    status: "review",
    executionSummary: { latestFailureReason: null, latestFailureMessage: null, dependencyNote: null },
    hold: {
      kind: "awaiting_ceo_review",
      resolver: "ceo_office",
      subjectKind: "business_artifact",
      subjectId: artifact.id,
      reason: `${task.title} is waiting for a CEO Office review decision.`,
    },
    now,
    createId,
  }).task;
  const event = appendEvent(context, parked, {
    type: source === "proof_recovery" ? "proof_recovered" : "task_review",
    message: source === "proof_recovery"
      ? `Proof recovered: ${task.title} submitted to CEO Office for review.`
      : "Task is ready for review.",
    status: "review",
  });
  const progressEvent = appendProgress(context, parked, { step: "awaiting_review", status: "current", label: "Awaiting review" });
  return { outcome: "awaiting_ceo_review", task: parked, events: [event], progressEvent };
}

type Context = { repositories: Repositories; now: () => Date; createId: (prefix: string) => string };

/**
 * Record a Task Completion Event unless one already records this artifact with this outcome. Recovery
 * can deliver the same artifact a run already delivered; a second event would duplicate its Founder
 * Decisions and the CEO Office items projected from them.
 */
function recordCompletionOnce(
  context: Context,
  task: Task,
  artifact: BusinessArtifact,
  outcome: TaskCompletionOutcome,
  extra: { founderDecisions?: FounderDecisionDeclaration[]; dependencyImpact?: unknown },
): void {
  const alreadyRecorded = context.repositories
    .listTaskCompletionEventsForTask(task.id)
    .some((event) => event.businessArtifactId === artifact.id && event.outcome === outcome);
  if (alreadyRecorded) {
    return;
  }
  recordTaskCompletionEvent({
    repositories: context.repositories,
    task,
    businessArtifact: artifact,
    outcome,
    ...(extra.founderDecisions
      ? {
        founderDecisions: extra.founderDecisions,
        founderDecisionBlockedTaskIds: context.repositories.listDependencyConsumers(task.id).map((consumer) => consumer.id),
      }
      : {}),
    ...(extra.dependencyImpact !== undefined ? { dependencyImpact: extra.dependencyImpact } : {}),
    now: context.now,
    createId: context.createId,
  });
}

function appendEvent(
  context: Context,
  task: Task,
  event: {
    type: TaskEvent["type"];
    message: string;
    status: TaskStatus;
    failureReason?: TaskEvent["failureReason"];
    failureMessage?: string;
  },
): TaskEvent {
  const record: TaskEvent = {
    id: context.createId("task_event"),
    companyId: task.companyId,
    taskId: task.id,
    type: event.type,
    message: event.message,
    createdAt: context.now().toISOString(),
    status: event.status,
    failureReason: event.failureReason ?? null,
    failureMessage: event.failureMessage ?? null,
    executionProfileName: task.latestExecutionProfileName ?? null,
    requestedTimeoutMs: task.latestRequestedTimeoutMs ?? null,
    effectiveTimeoutMs: task.latestEffectiveTimeoutMs ?? null,
    dependencyNote: null,
    artifactWorkspacePath: task.artifactWorkspacePath ?? null,
  };
  context.repositories.appendTaskEvent(record);
  return record;
}

function appendProgress(
  context: Context,
  task: Task,
  progress: { step: TaskProgressEvent["step"]; status: TaskProgressEvent["status"]; label: string; detail?: string },
): TaskProgressEvent {
  const record: TaskProgressEvent = {
    id: context.createId("task_progress"),
    companyId: task.companyId,
    departmentId: task.departmentId,
    parentTaskId: task.parentTaskId ?? task.id,
    subjectTaskId: task.id,
    step: progress.step,
    status: progress.status,
    label: progress.label,
    detail: progress.detail ?? null,
    createdAt: context.now().toISOString(),
  };
  context.repositories.appendTaskProgressEvent(record);
  return record;
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
