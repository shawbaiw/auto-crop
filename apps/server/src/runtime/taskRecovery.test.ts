import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentRun, Company, Department, KeyResult, Objective, Task } from "@auto-crop/core";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { Supervisor } from "./supervisor";
import { runSchedulerOnce } from "./scheduler";
import { reconcileStaleRunningTasks, recoverTask } from "./taskRecovery";
import { createRuntimeActionChannel } from "./runtimeActionChannel";

describe("task recovery", () => {
  it.each(["run", "orphan"])("rolls back %s reconciliation when outbox writing fails, then recovers after reopen", (kind) => {
    const dir = mkdtempSync(join(tmpdir(), "k2-settlement-"));
    const path = join(dir, "state.sqlite");
    const { repositories, client } = createFixture([{ ...createTaskRecord(), status: "running" }], path);
    const at = "2026-08-25T00:06:00.000Z";
    const now = () => new Date(at);
    repositories.acquireTaskLock("task_1", "worker_1", "2026-08-25T00:00:00.000Z");
    if (kind === "run") repositories.createAgentRun(createAgentRunRecord());
    const nextId = createSequentialIdFactory();
    try {
      expect(() => reconcileStaleRunningTasks({
        repositories, companyId: "company_1", now,
        createId: (prefix) => {
          if (prefix === "outbox_event") throw new Error("outbox unavailable");
          return nextId(prefix);
        },
      })).toThrow("outbox unavailable");
      expect(repositories.getTask("task_1")?.status).toBe("running");
      expect(repositories.listTaskLocks()).toHaveLength(1);
      expect(repositories.listOpenTaskHolds("task_1")).toEqual([]);
      expect(repositories.listTaskEventsForCompany("company_1")).toEqual([]);
      expect(repositories.listTaskProgressEventsForCompany("company_1")).toEqual([]);
      expect(repositories.listOutboxEvents({ companyId: "company_1" })).toEqual([]);
      if (kind === "run") expect(repositories.listRunningAgentRuns("company_1")).toHaveLength(1);
    } finally { client.close(); }
    const reopened = createDatabaseClient(path);
    try {
      const recovered = createRepositories(reopened);
      expect(reconcileStaleRunningTasks({ repositories: recovered, companyId: "company_1", now }).reconciledTaskIds).toEqual(["task_1"]);
      expect(reconcileStaleRunningTasks({ repositories: recovered, companyId: "company_1", now }).reconciledTaskIds).toEqual([]);
      const events = recovered.listOutboxEvents({ companyId: "company_1" });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        runId: kind === "run" ? "agent_run_1" : null,
        reason: kind === "run" ? "timeout" : "worker_lost", terminationConfirmed: null,
      });
    } finally { reopened.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it.each(["direct", "scheduler", "supervisor", "recover"])("publishes the same timeout facts through %s", async (entry) => {
    const { repositories, client } = createFixture([{ ...createTaskRecord(), status: "running" }]);
    const now = () => new Date("2026-08-25T00:06:00.000Z");
    repositories.acquireTaskLock("task_1", "worker_1", "2026-08-25T00:00:00.000Z");
    repositories.createAgentRun(createAgentRunRecord());
    repositories.updateAgentRunObservation("agent_run_1", { phase: "executing", lastHeartbeatAt: "2026-08-25T00:01:00.000Z" });
    try {
      if (entry === "scheduler") {
        await runSchedulerOnce({ repositories, projectRoot: ".", adapters: [], workerId: "other", maxTasks: 1, proofCollector: () => [], emit: () => undefined, now });
      } else if (entry === "supervisor") {
        await new Supervisor({ repositories, supervisorId: "supervisor", now }).scanOnce();
      } else if (entry === "recover") {
        recoverTask({ runtimeActionChannel: createRuntimeActionChannel(), repositories, taskId: "task_1", now });
      } else {
        reconcileStaleRunningTasks({ repositories, companyId: "company_1", now });
      }
      const events = repositories.listOutboxEvents({ companyId: "company_1" });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        type: "execution_failed", taskId: "task_1", runId: "agent_run_1", ownerEpoch: null,
        phase: "executing", reason: "timeout", observedAt: now().toISOString(),
        lastHeartbeatAt: "2026-08-25T00:01:00.000Z", terminationConfirmed: null,
      });
      if (entry === "supervisor") expect(repositories.listRecoveryDecisions("company_1")).toHaveLength(1);
    } finally { client.close(); }
  });

  it("does not reap an orphan whose lock another connection renewed after the scan", () => {
    const dir = mkdtempSync(join(tmpdir(), "k2-renewal-"));
    const path = join(dir, "state.sqlite");
    const { repositories, client } = createFixture([{ ...createTaskRecord(), status: "running" }], path);
    const other = createDatabaseClient(path);
    repositories.acquireTaskLock("task_1", "worker_1", "2026-08-25T00:00:00.000Z");
    try {
      const result = reconcileStaleRunningTasks({
        repositories: { ...repositories, claimOrphanedTask: (claim) => {
          other.prepare("UPDATE task_locks SET lease_expires_at = ? WHERE task_id = ?")
            .run("2026-08-25T00:10:00.000Z", "task_1");
          return repositories.claimOrphanedTask(claim);
        } }, companyId: "company_1", now: () => new Date("2026-08-25T00:06:00.000Z"),
      });
      expect(result.reconciledTaskIds).toEqual([]);
      expect(repositories.getTask("task_1")?.status).toBe("running");
      expect(repositories.listTaskLocks()[0].leaseExpiresAt).toBe("2026-08-25T00:10:00.000Z");
      expect(repositories.listOutboxEvents({ companyId: "company_1" })).toEqual([]);
    } finally { other.close(); client.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("lets only one of two connections settle a run and publish its event", () => {
    const dir = mkdtempSync(join(tmpdir(), "k2-race-"));
    const path = join(dir, "state.sqlite");
    const { repositories, client } = createFixture([{ ...createTaskRecord(), status: "running" }], path);
    const other = createDatabaseClient(path);
    const rival = createRepositories(other);
    repositories.acquireTaskLock("task_1", "worker_1", "2026-08-25T00:00:00.000Z");
    repositories.createAgentRun(createAgentRunRecord());
    const now = () => new Date("2026-08-25T00:06:00.000Z");
    try {
      const result = reconcileStaleRunningTasks({
        repositories: { ...repositories, updateAgentRunStatus: (...args) => {
          reconcileStaleRunningTasks({ repositories: rival, companyId: "company_1", now });
          return repositories.updateAgentRunStatus(...args);
        } }, companyId: "company_1", now,
      });
      expect(result.reconciledTaskIds).toEqual([]);
      expect(repositories.listOutboxEvents({ companyId: "company_1" })).toHaveLength(1);
      expect(repositories.listTaskEventsForCompany("company_1")).toHaveLength(1);
      expect(repositories.listOpenTaskHolds("task_1")).toHaveLength(1);
    } finally { other.close(); client.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("does not let an old epoch settle the current task", () => {
    const { repositories, client } = createFixture([{ ...createTaskRecord(), status: "running" }]);
    try {
      const epoch = repositories.nextExecutionEpoch("task_1");
      repositories.createAgentRun({ ...createAgentRunRecord(), ownerEpoch: epoch });
      repositories.nextExecutionEpoch("task_1");
      const result = reconcileStaleRunningTasks({ repositories, companyId: "company_1", now: () => new Date("2026-08-25T00:06:00.000Z") });
      expect(result.reconciledTaskIds).toEqual([]);
      expect(repositories.getTask("task_1")?.status).toBe("running");
      expect(repositories.listOutboxEvents({ companyId: "company_1" })).toEqual([]);
    } finally { client.close(); }
  });

  it("marks stale running tasks as timed out and clears their lock", () => {
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        status: "running",
      },
    ]);
    fixture.repositories.acquireTaskLock("task_1", "worker_1", "2026-08-25T00:00:00.000Z");
    fixture.repositories.createAgentRun(createAgentRunRecord());

    // One second past the 3m budget the run may still be finalizing — capture and an Artifact Syntax
    // Repair happen after the agent returns, with the run row still `running` (ADR 0034).
    const inGrace = reconcileStaleRunningTasks({
      repositories: fixture.repositories,
      companyId: "company_1",
      now: () => new Date("2026-08-25T00:03:01.000Z"),
      createId: createSequentialIdFactory(),
    });
    expect(inGrace.reconciledTaskIds).toEqual([]);
    expect(fixture.repositories.getTask("task_1")?.status).toBe("running");

    const result = reconcileStaleRunningTasks({
      repositories: fixture.repositories,
      companyId: "company_1",
      // Past the budget and the finalization grace: nobody is finishing this one.
      now: () => new Date("2026-08-25T00:06:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.reconciledTaskIds).toEqual(["task_1"]);
    expect(fixture.repositories.getTask("task_1")).toMatchObject({
      status: "failed",
      latestFailureReason: "timeout",
      latestFailureMessage: "Task failed: Record implementation changes / timeout after 3m.",
    });
    expect(fixture.repositories.listRunningAgentRuns("company_1")).toEqual([]);
    expect(fixture.repositories.listTaskLocks()).toEqual([]);
    expect(fixture.repositories.listTaskEventsForCompany("company_1")).toContainEqual(
      expect.objectContaining({
        type: "task_failed",
        taskId: "task_1",
        status: "failed",
        failureReason: "timeout",
      }),
    );
    expect(fixture.repositories.listTaskProgressEventsForCompany("company_1")).toContainEqual(
      expect.objectContaining({
        parentTaskId: "task_1",
        subjectTaskId: "task_1",
        step: "blocked",
        status: "blocked",
        label: "Task timed out and is waiting for recovery.",
      }),
    );
  });

  /**
   * The reciprocal half of the claim (ADR 0034). Between reading the running runs and writing the
   * timeout, the scheduler can settle that run — so the write is conditional, and losing it must stop
   * everything else this reconcile would have done to the task.
   */
  it("touches nothing when the run it read as running was settled before it could write", () => {
    const fixtureState = createFixture([{ ...createTaskRecord(), status: "running" }]);
    const { repositories } = fixtureState;
    repositories.acquireTaskLock("task_1", "worker_1", "2026-08-25T00:00:00.000Z");
    const staleRun = createAgentRunRecord();
    repositories.createAgentRun(staleRun);
    // The scheduler wins the claim first.
    expect(repositories.updateAgentRunStatus(staleRun.id, "complete", "2026-08-25T00:01:00.000Z", { expectedStatus: "running" })).toBe(true);

    const result = reconcileStaleRunningTasks({
      // What this reconcile read a moment ago, before the settlement landed.
      repositories: { ...repositories, listRunningAgentRuns: () => [staleRun] },
      companyId: "company_1",
      now: () => new Date("2026-08-25T01:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.reconciledTaskIds).toEqual([]);
    expect(repositories.getTask("task_1")?.status).toBe("running");
    expect(repositories.listTaskLocks()).toHaveLength(1);
    expect(repositories.listTaskEventsForCompany("company_1")).toEqual([]);
    fixtureState.client.close();
  });

  it("refuses to recover a task that has exhausted its recovery attempts", () => {
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        status: "blocked",
        latestFailureReason: "retry_exhausted",
        latestFailureMessage: "Task blocked: Record implementation changes / retry_exhausted.",
      },
    ]);
    for (const id of ["run_1", "run_2", "run_3"]) {
      fixture.repositories.createAgentRun({ ...createAgentRunRecord(), id, status: "failed" });
    }

    expect(() =>
      recoverTask({
        runtimeActionChannel: createRuntimeActionChannel(),
        repositories: fixture.repositories,
        taskId: "task_1",
        now: () => new Date("2026-08-25T00:03:01.000Z"),
        createId: createSequentialIdFactory(),
      }),
    ).toThrow(/retry_exhausted/i);
    expect(fixture.repositories.getTask("task_1")?.status).toBe("blocked");
  });

  it("routes a still-failed exhausted task into the CEO Blocked Queue before refusing", () => {
    // A task left `failed` (not `blocked`) by a path that never ran the ceiling routing -- e.g. an
    // agent run from before Bounded Recovery existed. `recover` must still land it in the Blocked
    // Queue so the CEO can see it, not just bounce off with an error.
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        status: "failed",
        latestFailureReason: "no_proof",
        latestFailureMessage: "Task failed: Record implementation changes / no_proof.",
      },
    ]);
    for (const id of ["run_1", "run_2", "run_3"]) {
      fixture.repositories.createAgentRun({ ...createAgentRunRecord(), id, status: "failed" });
    }

    expect(() =>
      recoverTask({
        runtimeActionChannel: createRuntimeActionChannel(),
        repositories: fixture.repositories,
        taskId: "task_1",
        now: () => new Date("2026-08-25T00:03:01.000Z"),
        createId: createSequentialIdFactory(),
      }),
    ).toThrow(/retry_exhausted/i);

    const task = fixture.repositories.getTask("task_1");
    expect(task?.status).toBe("blocked");
    expect(task?.latestFailureReason).toBe("retry_exhausted");
    expect(fixture.repositories.listTaskEventsForCompany("company_1")).toContainEqual(
      expect.objectContaining({ taskId: "task_1", type: "task_blocked", failureReason: "retry_exhausted" }),
    );
    expect(
      fixture.repositories.listTaskCompletionEventsForCompany("company_1").some((event) => event.outcome === "blocked"),
    ).toBe(true);
  });

  it("requeues a failed timeout task when there is no Partial Output", () => {
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        status: "failed",
        latestFailureReason: "timeout",
        latestFailureMessage: "Task failed: Record implementation changes / timeout after 3m.",
      },
    ]);

    const result = recoverTask({
        runtimeActionChannel: createRuntimeActionChannel(),
      repositories: fixture.repositories,
      taskId: "task_1",
      proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
      now: () => new Date("2026-08-25T00:04:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.task.status).toBe("queued");
    expect(result.recovery).toEqual({
      status: "queued",
      message: "Task recovered and queued for another run.",
    });
    expect(result.event).toMatchObject({
      type: "task_recovered",
      status: "queued",
      failureReason: null,
    });
  });

  it("creates a recovery follow-up from Partial Output and moves downstream dependencies", () => {
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        status: "failed",
        latestFailureReason: "timeout",
        latestFailureMessage: "Task failed: Record implementation changes / timeout after 3m.",
        artifactWorkspacePath: ".auto-crop/workspaces/task_1",
      },
      {
        ...createTaskRecord(),
        id: "task_2",
        title: "Prepare launch assets",
        position: 1,
        status: "waiting_dependency",
      },
    ]);
    fixture.repositories.createTaskDependency({
      taskId: "task_2",
      dependsOnTaskId: "task_1",
      handoffContract: "Use implementation notes.",
    });

    const result = recoverTask({
        runtimeActionChannel: createRuntimeActionChannel(),
      repositories: fixture.repositories,
      taskId: "task_1",
      proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
      now: () => new Date("2026-08-25T00:04:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    const recoveryTask = fixture.repositories.listTasksForCompany("company_1").find((task) => task.id === "recovery_task_1");
    expect(result.followUpTask).toEqual(recoveryTask);
    expect(recoveryTask).toMatchObject({
      title: "Record implementation changes (recovery)",
      status: "queued",
      workspacePath: ".auto-crop/workspaces/task_1",
      artifactWorkspacePath: ".auto-crop/workspaces/task_1",
    });
    expect(recoveryTask?.description).toContain("## Proof Contract");
    expect(recoveryTask?.description).toContain("Original Proof Schema: repo-diff");
    expect(recoveryTask?.description).toContain(".auto-crop-proof/task_1.diff");
    expect(recoveryTask?.description).toContain("Files under `.auto-crop/` are not proof for repo-diff tasks.");
    expect(fixture.repositories.getTask("task_1")).toMatchObject({
      status: "failed",
      latestFailureReason: "timeout",
    });
    expect(fixture.repositories.listTaskDependencies("task_2")).toEqual([
      expect.objectContaining({ taskId: "task_2", dependsOnTaskId: "recovery_task_1" }),
    ]);
    expect(result.recovery).toEqual({
      status: "follow_up_created",
      message: "Recovery task created from Partial Output and queued for another run.",
    });
  });

  /**
   * The leftover state combinations a crash mid-dispatch leaves behind.
   *
   * These used to be permanent. Reconciliation is indexed by running runs, so a dispatch that died
   * before its run row existed left a lock nothing could see and nothing would clear, and that task
   * never ran again. The fix is not to prove the dead worker is gone — nothing can — but to make its
   * leftovers reclaimable: the lock carries a lease its holder renews, and silence past the lease is
   * what lets the task move on (execution-health P2b).
   */
  describe("leftover state after a worker dies mid-dispatch", () => {
    const leaseOf = (expiresAt: string) => ({ expiresAt, now: "2026-08-25T00:00:00.000Z" });

    it("lets another dispatch take over a queued task whose holder stopped renewing", () => {
      const fixture = createFixture([{ ...createTaskRecord(), status: "queued" }]);
      fixture.repositories.acquireTaskLock("task_1", "worker_1", "2026-08-25T00:00:00.000Z", leaseOf("2026-08-25T00:01:30.000Z"));

      // While the lease holds, nobody else gets in.
      expect(
        fixture.repositories.acquireTaskLock("task_1", "worker_2", "2026-08-25T00:01:00.000Z", {
          expiresAt: "2026-08-25T00:02:30.000Z",
          now: "2026-08-25T00:01:00.000Z",
        }),
      ).toBe(false);

      // Once it lapses, the task is available again — no reconciliation pass required.
      expect(
        fixture.repositories.acquireTaskLock("task_1", "worker_2", "2026-08-25T00:05:00.000Z", {
          expiresAt: "2026-08-25T00:06:30.000Z",
          now: "2026-08-25T00:05:00.000Z",
        }),
      ).toBe(true);
      expect(fixture.repositories.listTaskLocks()).toEqual([
        expect.objectContaining({ taskId: "task_1", ownerId: "worker_2", runId: null }),
      ]);
    });

    it("recovers a running task whose run was never recorded", () => {
      const fixture = createFixture([{ ...createTaskRecord(), status: "running" }]);
      // The shape a crash between taking the lock and creating the run leaves: a task that says it is
      // executing, and no run to account for it.
      fixture.repositories.acquireTaskLock("task_1", "worker_1", "2026-08-25T00:00:00.000Z", leaseOf("2026-08-25T00:01:30.000Z"));

      // Inside the lease this is a dispatch in flight, and is left alone.
      expect(
        reconcileStaleRunningTasks({
          repositories: fixture.repositories,
          companyId: "company_1",
          now: () => new Date("2026-08-25T00:01:00.000Z"),
          createId: createSequentialIdFactory(),
        }).reconciledTaskIds,
      ).toEqual([]);
      expect(fixture.repositories.getTask("task_1")?.status).toBe("running");

      const result = reconcileStaleRunningTasks({
        repositories: fixture.repositories,
        companyId: "company_1",
        now: () => new Date("2026-08-25T00:05:00.000Z"),
        createId: createSequentialIdFactory(),
      });

      // Past the lease, nobody is speaking for it: it gets a failure, a Hold with a way forward, and
      // its lock back.
      expect(result.reconciledTaskIds).toEqual(["task_1"]);
      expect(fixture.repositories.getTask("task_1")).toMatchObject({
        status: "failed",
        latestFailureReason: "worker_lost",
      });
      expect(fixture.repositories.listOpenTaskHolds("task_1").map((hold) => hold.kind)).toEqual(["runtime_interrupted"]);
      expect(fixture.repositories.listTaskLocks()).toEqual([]);
      expect(result.events).toContainEqual(
        expect.objectContaining({ type: "task_failed", taskId: "task_1", failureReason: "worker_lost" }),
      );
    });

    it("leaves a running task alone when it holds no lock at all", () => {
      // Never dispatched by this runtime — a hand-edited row, or one from before locks existed.
      // Reaping on that guess would let one wrong assumption fail tasks in bulk.
      const fixture = createFixture([{ ...createTaskRecord(), status: "running" }]);

      const result = reconcileStaleRunningTasks({
        repositories: fixture.repositories,
        companyId: "company_1",
        now: () => new Date("2026-08-26T00:00:00.000Z"),
        createId: createSequentialIdFactory(),
      });

      expect(result.reconciledTaskIds).toEqual([]);
      expect(fixture.repositories.getTask("task_1")?.status).toBe("running");
    });

    it("frees a lock left behind by a settlement that already finished", () => {
      const fixture = createFixture([{ ...createTaskRecord(), status: "failed" }]);
      fixture.repositories.acquireTaskLock("task_1", "worker_1", "2026-08-25T00:00:00.000Z", leaseOf("2026-08-25T00:01:30.000Z"));
      fixture.repositories.createAgentRun({
        ...createAgentRunRecord(),
        status: "failed",
        finishedAt: "2026-08-25T00:03:00.000Z",
        failureReason: "timeout",
      });

      // The task is already settled, so nothing needs reconciling — but the leaked lock must not keep
      // the task out of service, and an expired lease is enough for the next dispatch to take it.
      expect(
        fixture.repositories.acquireTaskLock("task_1", "worker_2", "2026-08-25T06:00:00.000Z", {
          expiresAt: "2026-08-25T06:01:30.000Z",
          now: "2026-08-25T06:00:00.000Z",
        }),
      ).toBe(true);
    });
  });
});

function createFixture(tasks: Task[], path = ":memory:") {
  const client = createDatabaseClient(path);
  migrate(client);
  const repositories = createRepositories(client);

  repositories.createCompany(createCompanyRecord());
  repositories.createDepartment(createDepartmentRecord());
  repositories.createObjective(createObjectiveRecord());
  repositories.createKeyResult(createKeyResultRecord());
  for (const task of tasks) {
    repositories.createTask(task);
  }

  return { repositories, client };
}

function createCompanyRecord(): Company {
  return {
    id: "company_1",
    name: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    locale: "en",
    selectedCeoAgentId: "codex",
    playbookId: "ai-saas",
    status: "active",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };
}

function createDepartmentRecord(): Department {
  return {
    id: "department_1",
    companyId: "company_1",
    name: "Engineering",
    responsibility: "Build prototypes.",
    leadAgentId: "codex",
    memoryPath: ".auto-crop/companies/company_1/departments/engineering/memory.md",
  };
}

function createObjectiveRecord(): Objective {
  return {
    id: "objective_1",
    companyId: "company_1",
    title: "Validate first wedge",
    status: "active",
    priority: 1,
  };
}

function createKeyResultRecord(): KeyResult {
  return {
    id: "key_result_1",
    objectiveId: "objective_1",
    title: "Ship proof-backed prototype",
    metricName: "proof_status",
    targetValue: "proof_received",
    currentValue: "not_started",
    status: "active",
  };
}

function createTaskRecord(): Task {
  return {
    id: "task_1",
    companyId: "company_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    title: "Record implementation changes",
    description: "Record implementation changes.",
    assigneeAgentId: "codex",
    requiredCapabilities: ["code"],
    proofSchemaId: "repo-diff",
    workspacePath: ".auto-crop/workspaces/task_1",
    status: "queued",
    riskLevel: "medium",
    position: 0,
  };
}

function createAgentRunRecord(): AgentRun {
  return {
    id: "agent_run_1",
    taskId: "task_1",
    agentId: "codex",
    status: "running",
    logPath: ".auto-crop/companies/company_1/logs/task_1.log",
    startedAt: "2026-08-25T00:00:00.000Z",
    finishedAt: null,
    executionProfileName: "short",
    requestedTimeoutMs: 180_000,
    effectiveTimeoutMs: 180_000,
    failureReason: null,
    failureMessage: null,
  };
}

function createSequentialIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}
