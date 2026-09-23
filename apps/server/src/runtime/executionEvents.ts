import type { createRepositories } from "../db/repositories";

type Repositories = ReturnType<typeof createRepositories>;

/**
 * What happened to an execution, in the vocabulary a recovery decision is made from.
 *
 * Deliberately not the task event stream. Task events are a narrative for the founder and are
 * written wherever something worth narrating happens; these are the facts a machine acts on, and
 * every one of them has to carry enough to decide without re-reading the world. Mixing the two is
 * how a diagnostic ends up impersonating a completion (execution-health §8.1).
 */
export type ExecutionEventType =
  | "execution_budget_review"
  | "execution_completed"
  | "execution_failed"
  | "execution_stop_requested"
  | "recovery_scheduled"
  | "recovery_blocked";

/** Bumped when the payload shape changes, so an old event is read under the rules it was written by. */
export const EXECUTION_EVENT_VERSION = 1;

export type ExecutionEventPayload = {
  version: number;
  eventId: string;
  type: ExecutionEventType;
  companyId: string;
  taskId: string | null;
  runId: string | null;
  ownerEpoch: number | null;
  phase: string | null;
  reason: string | null;
  observedAt: string;
  lastHeartbeatAt: string | null;
  lastActivityAt: string | null;
  effectiveTimeoutMs: number | null;
  /** Whether termination was confirmed. Null when no confirmation evidence is available, including Worker loss. */
  terminationConfirmed: boolean | null;
  /** Where the full output lives. A reference, never the output itself. */
  logPath: string | null;
};

export type OutboxEvent = {
  id: string;
  version: number;
  type: ExecutionEventType;
  companyId: string;
  taskId: string | null;
  runId: string | null;
  payload: ExecutionEventPayload;
  createdAt: string;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  deliveredAt: string | null;
  deadLetteredAt: string | null;
};

/**
 * Record an execution event for delivery.
 *
 * Must be called inside the transaction that records the state change it describes. Outside it,
 * there are two failure modes and both are real: a settlement that commits without its event, so
 * nothing downstream ever hears about it, and an event for a settlement that rolled back, so
 * recovery acts on something that never happened.
 */
export function recordExecutionEvent(
  repositories: Repositories,
  input: {
    id: string;
    type: ExecutionEventType;
    companyId: string;
    taskId?: string | null;
    runId?: string | null;
    ownerEpoch?: number | null;
    phase?: string | null;
    reason?: string | null;
    observedAt: string;
    lastHeartbeatAt?: string | null;
    lastActivityAt?: string | null;
    effectiveTimeoutMs?: number | null;
    terminationConfirmed?: boolean | null;
    logPath?: string | null;
  },
): OutboxEvent {
  const payload: ExecutionEventPayload = {
    version: EXECUTION_EVENT_VERSION,
    eventId: input.id,
    type: input.type,
    companyId: input.companyId,
    taskId: input.taskId ?? null,
    runId: input.runId ?? null,
    ownerEpoch: input.ownerEpoch ?? null,
    phase: input.phase ?? null,
    reason: input.reason ?? null,
    observedAt: input.observedAt,
    lastHeartbeatAt: input.lastHeartbeatAt ?? null,
    lastActivityAt: input.lastActivityAt ?? null,
    effectiveTimeoutMs: input.effectiveTimeoutMs ?? null,
    terminationConfirmed: input.terminationConfirmed ?? null,
    logPath: input.logPath ?? null,
  };
  const event: OutboxEvent = {
    id: input.id,
    version: EXECUTION_EVENT_VERSION,
    type: input.type,
    companyId: input.companyId,
    taskId: input.taskId ?? null,
    runId: input.runId ?? null,
    payload,
    createdAt: input.observedAt,
    attempts: 0,
    nextAttemptAt: input.observedAt,
    lastError: null,
    deliveredAt: null,
    deadLetteredAt: null,
  };
  repositories.appendOutboxEvent(event);
  return event;
}

/** How long a dispatcher's claim on an event lasts before another may take it. */
export const OUTBOX_CLAIM_MS = 30_000;

/** After this many failed attempts an event is dead-lettered rather than retried forever. */
export const OUTBOX_MAX_ATTEMPTS = 8;

/** Exponential, capped: a consumer that is down should not be hammered, nor forgotten. */
export function outboxBackoffMs(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts - 1) * 1_000, 5 * 60_000);
}

export type DeliveryOutcome = { kind: "delivered" } | { kind: "failed"; error: string };

/**
 * Drains the outbox, one claimed batch at a time.
 *
 * Claims are persistent and expire, so a dispatcher that dies mid-delivery does not take its events
 * with it — the next one to run picks them up. Delivery is at-least-once by construction: an event
 * delivered just before a crash is delivered again afterwards, which is why every consumer is
 * idempotent on the event id rather than trusting it will be called once.
 */
export class OutboxDispatcher {
  constructor(
    private readonly input: {
      repositories: Repositories;
      dispatcherId: string;
      deliver: (event: OutboxEvent) => Promise<DeliveryOutcome> | DeliveryOutcome;
      now?: () => Date;
      batchSize?: number;
    },
  ) {}

  private now(): Date {
    return this.input.now?.() ?? new Date();
  }

  /** Deliver whatever is due. Returns what happened, for logging and for tests. */
  async drainOnce(): Promise<{ delivered: string[]; failed: string[]; deadLettered: string[] }> {
    const at = this.now();
    const claimed = this.input.repositories.claimOutboxEvents({
      dispatcherId: this.input.dispatcherId,
      now: at.toISOString(),
      claimExpiresAt: new Date(at.getTime() + OUTBOX_CLAIM_MS).toISOString(),
      limit: this.input.batchSize ?? 20,
    });

    const delivered: string[] = [];
    const failed: string[] = [];
    const deadLettered: string[] = [];

    for (const event of claimed) {
      let outcome: DeliveryOutcome;
      try {
        outcome = await this.input.deliver(event);
      } catch (error) {
        outcome = { kind: "failed", error: (error as Error).message };
      }

      const completedAt = this.now().toISOString();
      if (outcome.kind === "delivered") {
        this.input.repositories.markOutboxEventDelivered(event.id, completedAt);
        delivered.push(event.id);
        continue;
      }

      const attempts = event.attempts + 1;
      if (attempts >= OUTBOX_MAX_ATTEMPTS) {
        // Kept, not dropped: a dead letter is a thing an operator can look at and replay.
        this.input.repositories.markOutboxEventDeadLettered(event.id, completedAt, outcome.error);
        deadLettered.push(event.id);
        continue;
      }
      this.input.repositories.rescheduleOutboxEvent(
        event.id,
        new Date(this.now().getTime() + outboxBackoffMs(attempts)).toISOString(),
        outcome.error,
      );
      failed.push(event.id);
    }

    return { delivered, failed, deadLettered };
  }
}
