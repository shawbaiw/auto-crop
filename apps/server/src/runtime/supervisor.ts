import { ExecutionHealthMonitor } from "./executionHealth";
import type { ExecutionClock } from "./budgetPolicy";
import type { createRepositories } from "../db/repositories";
import { OutboxDispatcher, type DeliveryOutcome, type OutboxEvent } from "./executionEvents";
import { RecoveryCoordinator } from "./recoveryCoordinator";
import { reconcileExitedWorker } from "./workerExit";
import { reconcileStaleRunningTasks } from "./taskRecovery";

type Repositories = ReturnType<typeof createRepositories>;

/**
 * Watches executions from outside the process that runs them.
 *
 * The inner monitoring added in P1 lives in the worker, which is exactly the thing that can die: a
 * worker that is OOM-killed, or whose event loop wedges, stops observing at the same moment it stops
 * working, and nothing notices. Everything here is therefore designed to run in a *different*
 * process, against its own database connection, and to depend on nothing the worker serves — not its
 * HTTP API, not its scheduler loop, not its in-memory state. A supervisor that asked a wedged worker
 * whether it was healthy would be asking the patient.
 *
 * The host may supply containment for its exact owned Worker. Arbitrary Agent descendants and
 * remote owners remain outside that control channel and must stay isolated until confirmed gone.
 * This process cannot survive its own machine going down.
 */
export type SupervisorScanResult = {
  reconciledTaskIds: string[];
  deliveredEventIds: string[];
  failedEventIds: string[];
  deadLetteredEventIds: string[];
  decisions: Array<{ eventId: string; kind: string; alreadyDecided: boolean }>;
};

export type SupervisorInput = {
  repositories: Repositories;
  clock?: ExecutionClock;
  probeOwner?: (ownerId: string) => void;
  stopOwner?: (ownerId: string) => void;
  /** This supervisor's identity. Two supervisors on one database must not share it. */
  supervisorId: string;
  now?: () => Date;
  createId?: (prefix: string) => string;
  /**
   * Where a delivered event goes beyond the local coordinator — an operator's webhook, say.
   * Absent means local delivery only, which still counts as delivered.
   */
  forward?: (event: OutboxEvent) => Promise<DeliveryOutcome> | DeliveryOutcome;
  log?: (line: string) => void;
};

export class Supervisor {
  private readonly health: ExecutionHealthMonitor;
  private readonly coordinator: RecoveryCoordinator;
  private readonly dispatcher: OutboxDispatcher;

  constructor(private readonly input: SupervisorInput) {
    this.health = new ExecutionHealthMonitor(input);
    this.coordinator = new RecoveryCoordinator({
      repositories: input.repositories,
      now: input.now,
      createId: input.createId,
    });
    this.dispatcher = new OutboxDispatcher({
      repositories: input.repositories,
      dispatcherId: input.supervisorId,
      now: input.now,
      deliver: (event) => this.deliver(event),
    });
  }

  private readonly decisions: SupervisorScanResult["decisions"] = [];

  /**
   * Deliver one event: always to the local recovery coordinator, then to any external forwarder.
   *
   * The local consumer runs first and its decision is recorded whatever the forwarder does. An
   * operator's webhook being down must not stop the runtime from deciding what to do about a failed
   * run — that would make an external dependency a precondition for the system's own recovery.
   */
  private async deliver(event: OutboxEvent): Promise<DeliveryOutcome> {
    const outcome = this.coordinator.consume(event);
    this.decisions.push({ eventId: event.id, kind: outcome.decision.kind, alreadyDecided: outcome.alreadyDecided });
    this.input.log?.(
      `Supervisor decided ${outcome.decision.kind} for ${event.type} ${event.id}${outcome.alreadyDecided ? " (already decided)" : ""}`,
    );
    if (!this.input.forward) {
      return { kind: "delivered" };
    }
    return this.input.forward(event);
  }

  /**
   * One pass: reconcile what the worker left behind, then drain the outbox.
   *
   * Reconciliation runs first so a worker that died leaves its tasks recoverable *and* produces the
   * events that say so in the same pass, rather than a pass later.
   */
  async scanOnce(exitedOwnerIds: string[] = []): Promise<SupervisorScanResult> {
    this.decisions.length = 0;
    const reconciledTaskIds: string[] = [];
    for (const ownerId of exitedOwnerIds) {
      reconciledTaskIds.push(...reconcileExitedWorker({ ...this.input, ownerId }));
    }

    for (const company of this.input.repositories.listCompanies()) {
      const reconciled = reconcileStaleRunningTasks({
        repositories: this.input.repositories,
        companyId: company.id,
        exitedOwnerIds,
        now: this.input.now,
        createId: this.input.createId,
      });
      reconciledTaskIds.push(...reconciled.reconciledTaskIds);
    }

    this.health.scan();
    const drained = await this.dispatcher.drainOnce();
    return {
      reconciledTaskIds,
      deliveredEventIds: drained.delivered,
      failedEventIds: drained.failed,
      deadLetteredEventIds: drained.deadLettered,
      decisions: [...this.decisions],
    };
  }
}
