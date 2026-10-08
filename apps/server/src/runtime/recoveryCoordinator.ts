import { isAffordanceApplicable } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import type { OutboxEvent } from "./executionEvents";
import { briefRecoveryEligibility, RECOVERY_DELAY_MS, type RecoveryMode } from "./automaticRecovery";

type Repositories = ReturnType<typeof createRepositories>;

/**
 * What a failure is worth doing about, decided once per source event.
 *
 * `report_only` remains the default. Explicit brief-only opt-in records a bounded delayed recovery;
 * the normal scheduler still owns dispatch, permissions and cumulative execution accounting.
 */
export type RecoveryDecisionKind =
  | "scheduled"
  /** The runtime already offers a way back and a person can take it. Nothing to schedule. */
  | "report_only"
  /** Nothing to do: the run finished, or the task moved on under its own power. */
  | "no_action"
  /** A person must act before anything can move — permission, quota, an unconfirmed termination. */
  | "blocked";

export type RecoveryDecision = {
  kind: RecoveryDecisionKind;
  reason: string;
};

/**
 * Turns execution events into at most one decision each.
 *
 * The uniqueness of `sourceEventId` is the whole mechanism, not a detail: delivery is at-least-once,
 * so this consumer *will* see the same failure twice — after a dispatcher crash, after a redelivery,
 * after a restart mid-acknowledgement. Without a decision keyed to the event, each delivery would
 * queue another replacement execution for one failure (execution-health §3, invariant 12).
 *
 * Every decision re-reads the task inside the transaction that records it. The event describes the
 * world as it was when the run ended; by the time anyone acts, the founder may have cancelled the
 * task, a replan may have replaced it, or another run may already own it.
 */
export class RecoveryCoordinator {
  constructor(
    private readonly input: {
      repositories: Repositories;
      mode?: RecoveryMode;
      now?: () => Date;
      createId?: (prefix: string) => string;
    },
  ) {}

  /**
   * Consume one event. Returns the decision, whether or not this call is the one that recorded it.
   *
   * Safe to call repeatedly with the same event: the second call reports `alreadyDecided` and writes
   * nothing.
   */
  consume(event: OutboxEvent): { decision: RecoveryDecision; alreadyDecided: boolean } {
    const now = this.input.now?.() ?? new Date();
    const createId = this.input.createId ?? ((prefix: string) => `${prefix}_${crypto.randomUUID()}`);

    return this.input.repositories.transaction(() => {
      this.input.repositories.executionRecovery.lock();
      const existing = this.input.repositories.getRecoveryDecision(event.id);
      if (existing) return { decision: { kind: existing.decision as RecoveryDecisionKind, reason: existing.reason }, alreadyDecided: true };
      const decision = this.decide(event);
      if (decision.kind === "report_only" && this.input.mode === "brief-only-v1" && event.taskId) {
        const eligibility = briefRecoveryEligibility(this.input.repositories, event);
        if (eligibility.manifest && !this.input.repositories.executionRecovery.get(event.taskId)) {
          this.input.repositories.executionRecovery.schedule({ sourceEventId: event.id, taskId: event.taskId,
            sourceRunId: event.runId!, dueAt: new Date(now.getTime() + RECOVERY_DELAY_MS).toISOString(), manifest: eligibility.manifest });
          decision.kind = "scheduled";
          decision.reason = eligibility.reason;
        } else {
          decision.reason = eligibility.manifest ? "This Task already used its one automatic recovery." : eligibility.reason;
        }
      }
      const recorded = this.input.repositories.createRecoveryDecision({
        id: createId("recovery_decision"),
        sourceEventId: event.id,
        companyId: event.companyId,
        taskId: event.taskId,
        decision: decision.kind,
        reason: decision.reason,
        createdAt: now.toISOString(),
      });
      return { decision, alreadyDecided: !recorded };
    });
  }

  /**
   * What this event is worth doing about, read against the task as it stands now.
   *
   * The baseline remains conservative. Explicit automatic recovery may promote only a report-only
   * decision after its stricter eligibility checks; blocked and terminal outcomes never qualify.
   */
  private decide(event: OutboxEvent): RecoveryDecision {
    if (event.type === "recovery_scheduled" || event.type === "recovery_blocked") return { kind: "no_action", reason: "Recovery outcome is informational." };
    if (event.type === "execution_budget_review") return { kind: "no_action", reason: "The same run continues within its pinned budget." };
    if (event.type === "execution_completed") {
      return { kind: "no_action", reason: "The run completed; there is nothing to recover." };
    }

    const task = event.taskId ? this.input.repositories.getTask(event.taskId) : null;
    if (!task) {
      return { kind: "no_action", reason: "The task no longer exists." };
    }
    if (task.status === "cancelled") {
      return { kind: "no_action", reason: "The task was cancelled; a stopped task is not recovered." };
    }
    if (task.status === "complete") {
      return { kind: "no_action", reason: "The task has since completed." };
    }
    // Another run owns it now — the epoch moved on, so this event describes a superseded execution.
    if (event.payload.ownerEpoch !== null && task.status === "running") {
      return { kind: "no_action", reason: "Another run owns this task now." };
    }

    const holds = this.input.repositories.listOpenTaskHolds(task.id);
    const unconfirmed = holds.find((hold) => hold.kind === "termination_unconfirmed");
    if (unconfirmed) {
      return {
        kind: "blocked",
        reason: "A process that held this task's workspace was never confirmed stopped; a person must confirm it before anything runs there.",
      };
    }
    if (holds.some(hold => hold.kind === "execution_budget_exhausted")) return { kind: "blocked", reason: "Execution budget stopped this task; explicit founder authorization is required to resume." };
    const quota = holds.find((hold) => hold.kind === "agent_quota_exhausted");
    if (quota) {
      // Waiting is the action, and the reset time is not something to guess at (ADR 0032).
      return { kind: "blocked", reason: "The agent's account is out of quota; time resolves this, not a re-run." };
    }
    const exhausted = holds.find((hold) => hold.kind === "recovery_exhausted");
    if (exhausted) {
      return { kind: "blocked", reason: "The task reached the Bounded Recovery ceiling; only a replan or new upstream output resumes it." };
    }

    if (holds.length === 0) {
      return { kind: "no_action", reason: "The task is not parked; the runtime still owns it." };
    }
    if (!isAffordanceApplicable("recover_task", task.status)) {
      return { kind: "report_only", reason: `The task is parked in ${task.status} and waits on its Hold.` };
    }
    return {
      kind: "report_only",
      reason: `The run ended as ${event.payload.reason ?? "failed"}; the task is parked with a way forward and awaits a decision.`,
    };
  }
}
