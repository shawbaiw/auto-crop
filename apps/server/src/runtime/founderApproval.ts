import {
  localizedTextFromString,
  type Approval,
  type Task,
  type TaskEvent,
} from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { checkTaskAffordance, type TaskAffordanceState } from "./taskAffordances";
import { applyTaskTransition, releaseTaskHold } from "./taskTransition";

export type DecideFounderApprovalInput = {
  repositories: ReturnType<typeof createRepositories>;
  approvalId: string;
  decision: "approved" | "denied";
  note: string | null;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export type DecideFounderApprovalResult =
  | { kind: "not_found" }
  /** Answered once already. Approvals are not re-decidable; the audit trail keeps the first answer. */
  | { kind: "already_decided"; approval: Approval }
  /** The task stopped waiting on this approval — same refusal shape as every other stale action. */
  | { kind: "not_offered"; approval: Approval; task: Task; state: TaskAffordanceState }
  /** Decision recorded against an approval that names no task, so nothing to unblock. */
  | { kind: "recorded"; approval: Approval }
  | { kind: "decided"; approval: Approval; task: Task; event: TaskEvent };

/**
 * Answer a Founder Approval request and let the task move again.
 *
 * The scheduler parks a task needing consent in `blocked` with an `awaiting_founder_approval` Task
 * Hold naming the Approval record. Until this existed, `POST /api/approvals/:id` echoed the request
 * back without writing anything, so that Hold could never be cleared: the affordance was offered and
 * did nothing. An affordance no route honours is worse than none — it renders a button that lies.
 *
 * Granting returns the task to `queued`. Denying moves it to `needs_replan`, not back to `blocked`:
 * a task whose required action the founder has refused cannot run as specified, and saying so gives
 * the founder replanning as the way forward instead of the same dead approval request.
 */
export function decideFounderApproval(input: DecideFounderApprovalInput): DecideFounderApprovalResult {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const timestamp = now().toISOString();

  const approval = input.repositories.getApproval(input.approvalId);
  if (!approval) {
    return { kind: "not_found" };
  }

  if (approval.status !== "pending") {
    return { kind: "already_decided", approval };
  }

  const task = approval.taskId ? input.repositories.getTask(approval.taskId) : null;
  if (!task) {
    input.repositories.recordApprovalDecision(approval.id, input.decision, timestamp, input.note);
    return {
      kind: "recorded",
      approval: { ...approval, status: input.decision, decidedAt: timestamp, note: input.note },
    };
  }

  const offered = checkTaskAffordance(input.repositories, task, "decide_founder_approval");
  if (!offered.ok) {
    return { kind: "not_offered", approval, task, state: offered.state };
  }

  // The Hold this answer clears, named explicitly: a denial leaves the task parked for a different
  // reason, and without this the answered approval would stay open and keep offering itself.
  const answeredHold = offered.state.holds.find(
    (hold) => hold.kind === "awaiting_founder_approval" && hold.subjectId === approval.id,
  );

  input.repositories.recordApprovalDecision(approval.id, input.decision, timestamp, input.note);
  const decided: Approval = { ...approval, status: input.decision, decidedAt: timestamp, note: input.note };

  const message = input.decision === "approved"
    ? `Founder approved ${task.title}; it is queued to run.`
    : `Founder denied ${task.title}; it needs replanning before it can run.`;

  // Granting answers the approval Hold and nothing else: the task runs again only if that was the
  // last thing holding it. Denying is a new blocking fact, so it parks the task outright.
  const transition = input.decision === "approved"
    ? releaseTaskHold({
      repositories: input.repositories,
      task,
      holdId: answeredHold?.id ?? "",
      executionSummary: { latestFailureReason: null, latestFailureMessage: null, dependencyNote: null },
      now: input.now,
      createId,
    })
    : applyTaskTransition({
      repositories: input.repositories,
      task,
      status: "needs_replan",
      executionSummary: { latestFailureReason: "needs_replan", latestFailureMessage: message },
      hold: { kind: "needs_replan", reason: message },
      resolution: "cleared",
      resolvesHoldIds: answeredHold ? [answeredHold.id] : [],
      now: input.now,
      createId,
    });

  const event: TaskEvent = {
    id: createId("task_event"),
    companyId: task.companyId,
    taskId: task.id,
    type: "founder_approval",
    message,
    messageText: localizedTextFromString(message),
    createdAt: timestamp,
    status: transition.task.status,
    failureReason: input.decision === "denied" ? "needs_replan" : null,
    failureMessage: input.decision === "denied" ? message : null,
    executionProfileName: task.latestExecutionProfileName ?? null,
    requestedTimeoutMs: task.latestRequestedTimeoutMs ?? null,
    effectiveTimeoutMs: task.latestEffectiveTimeoutMs ?? null,
    dependencyNote: null,
    artifactWorkspacePath: task.artifactWorkspacePath ?? null,
  };
  input.repositories.appendTaskEvent(event);

  return { kind: "decided", approval: decided, task: transition.task, event };
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
