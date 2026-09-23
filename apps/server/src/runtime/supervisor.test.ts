import { describe, expect, it } from "vitest";
import type { AgentRun, Company, Department, KeyResult, Objective, Task } from "@auto-crop/core";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { OutboxDispatcher, OUTBOX_MAX_ATTEMPTS, recordExecutionEvent, type OutboxEvent } from "./executionEvents";
import { RecoveryCoordinator } from "./recoveryCoordinator";
import { Supervisor } from "./supervisor";

describe("the outbox", () => {
  it("gives an event to exactly one of two dispatchers", async () => {
    const { repositories, client } = createFixture();
    seedEvent(repositories, "outbox_event_1");
    const deliveredBy: string[] = [];
    const dispatcher = (id: string) =>
      new OutboxDispatcher({
        repositories,
        dispatcherId: id,
        now: () => new Date("2026-09-21T00:00:10.000Z"),
        deliver: () => {
          deliveredBy.push(id);
          return { kind: "delivered" };
        },
      });

    // Two dispatchers racing the same due event, as two supervisors on one database would.
    const first = await dispatcher("supervisor_a").drainOnce();
    const second = await dispatcher("supervisor_b").drainOnce();

    expect(first.delivered).toEqual(["outbox_event_1"]);
    expect(second.delivered).toEqual([]);
    expect(deliveredBy).toEqual(["supervisor_a"]);
    client.close();
  });

  /**
   * The crash that at-least-once delivery exists for: the consumer ran, the acknowledgement never
   * landed, and the event is still pending. It must be delivered again — and the consumer, not the
   * queue, is what keeps that from happening twice (execution-health §3, invariant 12).
   */
  it("redelivers an event whose dispatcher died before acknowledging it", async () => {
    const { repositories, client } = createFixture();
    seedEvent(repositories, "outbox_event_1");
    // A claim taken and never released, as a dispatcher killed mid-delivery leaves behind.
    repositories.claimOutboxEvents({
      dispatcherId: "supervisor_dead",
      now: "2026-09-21T00:00:10.000Z",
      claimExpiresAt: "2026-09-21T00:00:40.000Z",
      limit: 10,
    });

    const attempt = (at: string) =>
      new OutboxDispatcher({
        repositories,
        dispatcherId: "supervisor_b",
        now: () => new Date(at),
        deliver: () => ({ kind: "delivered" }),
      }).drainOnce();

    // While the dead dispatcher's claim stands, nobody else takes it.
    expect((await attempt("2026-09-21T00:00:20.000Z")).delivered).toEqual([]);
    // Once it expires, the event is picked up rather than lost with the process that held it.
    expect((await attempt("2026-09-21T00:01:00.000Z")).delivered).toEqual(["outbox_event_1"]);
    client.close();
  });

  it("backs off a failing consumer, then dead-letters it where an operator can replay it", async () => {
    const { repositories, client } = createFixture();
    seedEvent(repositories, "outbox_event_1");
    let at = Date.parse("2026-09-21T00:00:10.000Z");
    const dispatcher = new OutboxDispatcher({
      repositories,
      dispatcherId: "supervisor_a",
      now: () => new Date(at),
      deliver: () => ({ kind: "failed", error: "webhook returned 503" }),
    });

    for (let attempt = 0; attempt < OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      await dispatcher.drainOnce();
      // Far enough ahead that the backoff has always elapsed.
      at += 10 * 60_000;
    }

    const event = repositories.getOutboxEvent("outbox_event_1")!;
    expect(event.deadLetteredAt).not.toBeNull();
    expect(event.lastError).toBe("webhook returned 503");
    // Kept, not dropped: an operator can put it back after fixing the consumer.
    expect(repositories.replayDeadLetteredOutboxEvent("outbox_event_1", new Date(at).toISOString())).toBe(true);
    expect(repositories.getOutboxEvent("outbox_event_1")?.deadLetteredAt).toBeNull();
    client.close();
  });
});

describe("the recovery coordinator", () => {
  it("makes one decision for an event however many times it is delivered", () => {
    const { repositories, client } = createFixture();
    parkTaskAsFailed(repositories);
    const event = seedEvent(repositories, "outbox_event_1", { type: "execution_failed", reason: "agent_failed" });
    const coordinator = new RecoveryCoordinator({
      repositories,
      now: () => new Date("2026-09-21T00:00:10.000Z"),
      createId: sequentialId(),
    });

    const first = coordinator.consume(event);
    const second = coordinator.consume(event);

    expect(first.alreadyDecided).toBe(false);
    expect(second.alreadyDecided).toBe(true);
    expect(second.decision).toEqual(first.decision);
    // One failure, one decision — whatever at-least-once delivery does.
    expect(repositories.listRecoveryDecisions("company_1")).toHaveLength(1);
    client.close();
  });

  it("re-reads the task rather than trusting the event, and does not recover one that was cancelled", () => {
    const { repositories, client } = createFixture();
    parkTaskAsFailed(repositories);
    const event = seedEvent(repositories, "outbox_event_1", { type: "execution_failed", reason: "agent_failed" });
    // Between the run ending and anyone acting, the founder stopped the task.
    repositories.writeTaskStatusUnchecked("task_1", "cancelled");

    const decision = new RecoveryCoordinator({
      repositories, now: () => new Date("2026-09-21T00:00:10.000Z"), createId: sequentialId(),
    }).consume(event).decision;

    expect(decision.kind).toBe("no_action");
    expect(decision.reason).toContain("cancelled");
    client.close();
  });

  it("refuses to schedule anything for a workspace whose process was never confirmed stopped", () => {
    const { repositories, client } = createFixture();
    parkTaskAsFailed(repositories, "termination_unconfirmed");
    const event = seedEvent(repositories, "outbox_event_1", { type: "execution_failed", reason: "termination_unconfirmed" });

    const decision = new RecoveryCoordinator({
      repositories, now: () => new Date("2026-09-21T00:00:10.000Z"), createId: sequentialId(),
    }).consume(event).decision;

    expect(decision.kind).toBe("blocked");
    expect(decision.reason).toContain("confirm");
    client.close();
  });
});

describe("the supervisor", () => {
  /**
   * P3's completion condition, and the reason the supervisor exists at all: the worker is the thing
   * that can die, so the fault it leaves has to be noticed by something that is not the worker.
   */
  it("recovers what a dead worker abandoned and produces one failure event for it", async () => {
    const { repositories, client } = createFixture();
    // The state a worker killed mid-dispatch leaves: a task that says it is executing, a lock whose
    // lease nobody is renewing, and no run to account for it.
    repositories.writeTaskStatusUnchecked("task_1", "running");
    repositories.acquireTaskLock("task_1", "dead_worker", "2026-09-21T00:00:00.000Z", {
      expiresAt: "2026-09-21T00:01:30.000Z",
      now: "2026-09-21T00:00:00.000Z",
    });

    const supervisor = new Supervisor({
      repositories,
      supervisorId: "supervisor_a",
      now: () => new Date("2026-09-21T00:10:00.000Z"),
      createId: sequentialId(),
    });
    const result = await supervisor.scanOnce();

    expect(result.reconciledTaskIds).toEqual(["task_1"]);
    expect(repositories.getTask("task_1")).toMatchObject({ status: "failed", latestFailureReason: "worker_lost" });
    expect(repositories.listTaskLocks()).toEqual([]);
    // It did not only repair the row: it said so, durably, to a consumer that acted on it.
    expect(result.deliveredEventIds).toHaveLength(1);
    expect(result.decisions).toEqual([
      expect.objectContaining({ kind: "report_only", alreadyDecided: false }),
    ]);
    client.close();
  });

  it("keeps draining across its own restart, and still decides only once", async () => {
    const { repositories, client } = createFixture();
    parkTaskAsFailed(repositories);
    seedEvent(repositories, "outbox_event_1", { type: "execution_failed", reason: "agent_failed" });

    // One supervisor delivers locally but cannot reach the operator's webhook, so the event stays.
    const failing = new Supervisor({
      repositories, supervisorId: "supervisor_a",
      now: () => new Date("2026-09-21T00:00:10.000Z"), createId: sequentialId(),
      forward: () => ({ kind: "failed", error: "webhook offline" }),
    });
    const first = await failing.scanOnce();
    expect(first.failedEventIds).toEqual(["outbox_event_1"]);
    expect(repositories.listRecoveryDecisions("company_1")).toHaveLength(1);

    // It is replaced. The new one picks the queue up where the old one left it…
    const replacement = new Supervisor({
      repositories, supervisorId: "supervisor_b",
      now: () => new Date("2026-09-21T00:05:00.000Z"), createId: sequentialId(),
    });
    const second = await replacement.scanOnce();

    expect(second.deliveredEventIds).toEqual(["outbox_event_1"]);
    // …and the redelivery produces no second decision, which is what makes at-least-once safe.
    expect(second.decisions).toEqual([expect.objectContaining({ alreadyDecided: true })]);
    expect(repositories.listRecoveryDecisions("company_1")).toHaveLength(1);
    client.close();
  });

  /**
   * An operator's webhook is not a precondition for the runtime deciding what to do about its own
   * failures. If it were, an outage in someone else's system would stop recovery here.
   */
  it("decides locally even when the external forwarder is down", async () => {
    const { repositories, client } = createFixture();
    parkTaskAsFailed(repositories);
    seedEvent(repositories, "outbox_event_1", { type: "execution_failed", reason: "agent_failed" });

    const result = await new Supervisor({
      repositories, supervisorId: "supervisor_a",
      now: () => new Date("2026-09-21T00:00:10.000Z"), createId: sequentialId(),
      forward: () => {
        throw new Error("connect ECONNREFUSED");
      },
    }).scanOnce();

    // The delivery is retried later, and the decision was made now.
    expect(result.failedEventIds).toEqual(["outbox_event_1"]);
    expect(repositories.listRecoveryDecisions("company_1")).toHaveLength(1);
    client.close();
  });
});

function seedEvent(
  repositories: ReturnType<typeof createRepositories>,
  id: string,
  options: { type?: OutboxEvent["type"]; reason?: string } = {},
): OutboxEvent {
  return recordExecutionEvent(repositories, {
    id,
    type: options.type ?? "execution_failed",
    companyId: "company_1",
    taskId: "task_1",
    runId: "agent_run_1",
    reason: options.reason ?? "agent_failed",
    observedAt: "2026-09-21T00:00:00.000Z",
  });
}

function parkTaskAsFailed(
  repositories: ReturnType<typeof createRepositories>,
  holdKind: "runtime_interrupted" | "termination_unconfirmed" = "runtime_interrupted",
): void {
  repositories.writeTaskStatusUnchecked("task_1", holdKind === "termination_unconfirmed" ? "blocked" : "failed");
  repositories.openTaskHold({
    id: `task_hold_${holdKind}`,
    taskId: "task_1",
    companyId: "company_1",
    kind: holdKind,
    resolver: holdKind === "termination_unconfirmed" ? "founder" : "runtime",
    subjectKind: "agent_run",
    subjectId: "agent_run_1",
    reason: "The run stopped.",
    reasonText: null,
    openedAt: "2026-09-21T00:00:00.000Z",
    resolvedAt: null,
    resolution: null,
  });
}

function createFixture() {
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);
  repositories.createCompany({
    id: "company_1", name: "Pricing Page Studio", founderVision: "Build an AI SaaS.", locale: "en",
    selectedCeoAgentId: "codex", playbookId: "ai-saas", status: "active",
    createdAt: "2026-09-21T00:00:00.000Z", updatedAt: "2026-09-21T00:00:00.000Z",
  } satisfies Company);
  repositories.createDepartment({
    id: "department_1", companyId: "company_1", name: "Engineering",
    responsibility: "Build prototypes.", leadAgentId: "codex", memoryPath: "memory.md",
  } satisfies Department);
  repositories.createObjective({
    id: "objective_1", companyId: "company_1", title: "Validate", status: "active", priority: 1,
  } satisfies Objective);
  repositories.createKeyResult({
    id: "key_result_1", objectiveId: "objective_1", title: "Ship", metricName: "proof_status",
    targetValue: "proof_received", currentValue: "not_started", status: "active",
  } satisfies KeyResult);
  repositories.createTask({
    id: "task_1", companyId: "company_1", departmentId: "department_1", keyResultId: "key_result_1",
    title: "Record implementation changes", description: "Record implementation changes.",
    assigneeAgentId: "codex", requiredCapabilities: ["code"], proofSchemaId: "repo-diff",
    workspacePath: ".auto-crop/workspaces/task_1", status: "queued", riskLevel: "medium", position: 0,
  } satisfies Task);
  return { repositories, client };
}

function sequentialId(): (prefix: string) => string {
  const counts = new Map<string, number>();
  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

/** Unused but kept so the fixture's AgentRun shape stays in step with the table. */
export type SeededAgentRun = AgentRun;
