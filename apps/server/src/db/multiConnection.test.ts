import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRun, Company, Department, KeyResult, Objective, Task } from "@auto-crop/core";
import { createDatabaseClient } from "./client";
import { createRepositories } from "./repositories";
import { migrate } from "./schema";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * What the storage layer actually guarantees when more than one connection is open on the same
 * database file.
 *
 * Every other test in this repository runs against a single `:memory:` connection, which cannot
 * show a race at all: two callers in one connection are simply two function calls. The execution
 * health work (docs/execution-health-and-recovery-plan.md) is built on two assumptions this file
 * exists to settle — that a conditional update is an atomic claim, and that `transaction()` really
 * isolates — and its P3 Supervisor opens a second connection, so they stop being hypothetical.
 *
 * These use a real file: WAL and cross-connection locking do not exist for `:memory:`.
 */
describe("storage under a second connection", () => {
  const openDatabase = () => {
    const directory = mkdtempSync(join(tmpdir(), "auto-crop-multi-connection-"));
    createdDirs.push(directory);
    const path = join(directory, "state.sqlite");
    const first = createDatabaseClient(path);
    migrate(first);
    seedRunningTask(first);
    const second = createDatabaseClient(path);
    // There is no single-run getter on the repositories; read the row, as the scheduler tests do.
    const runStatus = (client: ReturnType<typeof createDatabaseClient>) =>
      (client.prepare("SELECT status FROM agent_runs WHERE id = ?").get("agent_run_1") as { status: string }).status;
    return { first, second, runStatus };
  };

  it("settles a run for exactly one of two connections racing the same claim", () => {
    const { first, second, runStatus } = openDatabase();
    const claim = (client: ReturnType<typeof createDatabaseClient>, status: AgentRun["status"]) =>
      createRepositories(client).updateAgentRunStatus("agent_run_1", status, "2026-09-21T00:10:00.000Z", {
        expectedStatus: "running",
      });

    // The two writers of ADR 0034, in separate processes: the dispatch settling its delivery and
    // whoever declares the run timed out.
    const settled = claim(first, "complete");
    const declaredTimedOut = claim(second, "failed");

    expect([settled, declaredTimedOut]).toEqual([true, false]);
    expect(runStatus(second)).toBe("complete");
    first.close();
    second.close();
  });

  it("gives a task to exactly one of two workers racing for it, and to neither while the lease holds", () => {
    const { first, second } = openDatabase();
    const take = (client: ReturnType<typeof createDatabaseClient>, worker: string, at: string) =>
      createRepositories(client).acquireTaskLock("task_1", worker, at, {
        expiresAt: new Date(Date.parse(at) + 90_000).toISOString(),
        now: at,
      });

    // Two workers, two connections, same task.
    expect([take(first, "worker_a", "2026-09-21T00:00:00.000Z"), take(second, "worker_b", "2026-09-21T00:00:00.000Z")])
      .toEqual([true, false]);

    // The loser keeps losing while the winner's lease is good.
    expect(take(second, "worker_b", "2026-09-21T00:01:00.000Z")).toBe(false);

    // Past the lease, the task is claimable again — the winner stopped renewing, so it is gone.
    expect(take(second, "worker_b", "2026-09-21T00:02:00.000Z")).toBe(true);
    expect(createRepositories(first).listTaskLocks()).toEqual([
      expect.objectContaining({ taskId: "task_1", ownerId: "worker_b" }),
    ]);
    first.close();
    second.close();
  });

  it("renews a lease only for the owner that still holds the run and the epoch", () => {
    const { first, second } = openDatabase();
    const holder = createRepositories(first);
    holder.acquireTaskLock("task_1", "worker_a", "2026-09-21T00:00:00.000Z", {
      expiresAt: "2026-09-21T00:01:30.000Z",
      now: "2026-09-21T00:00:00.000Z",
    });
    holder.bindTaskLockToRun("task_1", "worker_a", "agent_run_1", 4);

    // The owner extends its own lease.
    expect(holder.renewTaskLock("task_1", "worker_a", "agent_run_1", 4, "2026-09-21T00:03:00.000Z")).toBe(true);
    // A superseded generation cannot keep a lock alive for a run nobody is waiting on, and neither
    // can another worker or another run.
    expect(holder.renewTaskLock("task_1", "worker_a", "agent_run_1", 3, "2026-09-21T00:09:00.000Z")).toBe(false);
    expect(holder.renewTaskLock("task_1", "worker_a", "agent_run_2", 4, "2026-09-21T00:09:00.000Z")).toBe(false);
    expect(
      createRepositories(second).renewTaskLock("task_1", "worker_b", "agent_run_1", 4, "2026-09-21T00:09:00.000Z"),
    ).toBe(false);

    expect(createRepositories(second).listTaskLocks()[0]).toMatchObject({
      leaseExpiresAt: "2026-09-21T00:03:00.000Z",
      ownerEpoch: 4,
    });
    first.close();
    second.close();
  });

  it("hides a transaction's writes from the other connection until it commits, and unwinds them on rollback", () => {
    const { first, second, runStatus } = openDatabase();
    const repositories = createRepositories(first);

    expect(() =>
      repositories.transaction(() => {
        repositories.updateAgentRunStatus("agent_run_1", "complete", "2026-09-21T00:10:00.000Z", {
          expectedStatus: "running",
        });
        // Mid-transaction, the other connection still reads the pre-transaction state.
        expect(runStatus(second)).toBe("running");
        throw new Error("interrupted mid-settlement");
      }),
    ).toThrow("interrupted mid-settlement");

    // And the interrupted settlement left nothing behind, on either connection.
    expect(runStatus(first)).toBe("running");
    expect(runStatus(second)).toBe("running");
    first.close();
    second.close();
  });

  /**
   * The constraint that decides how a settlement transaction must be written.
   *
   * A transaction that reads before it writes holds only a read snapshot. If another connection
   * commits in that gap, the upgrade to a write fails — and no `busy_timeout` rescues it, because
   * the snapshot is stale rather than the lock merely busy. The transaction has to be retried from
   * the top, so it must not have committed anything yet.
   */
  it("refuses a transaction that reads before writing when the other connection commits in between", () => {
    const { first, second, runStatus } = openDatabase();
    const repositories = createRepositories(first);

    expect(() =>
      repositories.transaction(() => {
        // Read first…
        expect(runStatus(first)).toBe("running");
        // …another connection commits…
        createRepositories(second).updateAgentRunStatus("agent_run_1", "failed", "2026-09-21T00:10:00.000Z", {
          expectedStatus: "running",
        });
        // …and this transaction can no longer write.
        repositories.updateAgentRunStatus("agent_run_1", "complete", "2026-09-21T00:11:00.000Z", {
          expectedStatus: "running",
        });
      }),
    ).toThrow(/database is locked/);

    expect(runStatus(first)).toBe("failed");
    first.close();
    second.close();
  });

  /**
   * The same shape, written the way ADR 0034 already requires: the claim is the first statement, so
   * the transaction holds the write lock from the start and there is no snapshot left to invalidate.
   * This is why `settleRun` claims before it reads anything.
   */
  it("carries a claim-first transaction through to commit while the other connection is writing", () => {
    const { first, second, runStatus } = openDatabase();
    const repositories = createRepositories(first);

    const settled = repositories.transaction(() => {
      // Claim first: this takes the write lock.
      const won = repositories.updateAgentRunStatus("agent_run_1", "complete", "2026-09-21T00:10:00.000Z", {
        expectedStatus: "running",
      });
      // The other connection cannot get in behind us now. Its busy timeout is dropped to zero first,
      // so the exclusion is observed immediately instead of after the wait a real caller would take:
      // what is being asserted is that it is kept out, not how patiently.
      second.exec("PRAGMA busy_timeout = 0");
      expect(() =>
        createRepositories(second).updateAgentRunStatus("agent_run_1", "failed", "2026-09-21T00:10:30.000Z", {
          expectedStatus: "running",
        }),
      ).toThrow(/database is locked/);
      // Reads and writes after the claim are safe.
      expect(repositories.getTask("task_1")?.status).toBe("running");
      repositories.updateTaskArtifactWorkspacePath("task_1", "/workspace/task_1");
      return won;
    });

    expect(settled).toBe(true);
    expect(runStatus(second)).toBe("complete");
    expect(createRepositories(second).getTask("task_1")?.artifactWorkspacePath).toBe("/workspace/task_1");
    first.close();
    second.close();
  });
});

function seedRunningTask(client: ReturnType<typeof createDatabaseClient>): void {
  const repositories = createRepositories(client);
  repositories.createCompany({
    id: "company_1",
    name: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    locale: "en",
    selectedCeoAgentId: "codex",
    playbookId: "ai-saas",
    status: "active",
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  } satisfies Company);
  repositories.createDepartment({
    id: "department_1",
    companyId: "company_1",
    name: "Engineering",
    responsibility: "Build prototypes.",
    leadAgentId: "codex",
    memoryPath: ".auto-crop/companies/company_1/departments/engineering/memory.md",
  } satisfies Department);
  repositories.createObjective({
    id: "objective_1",
    companyId: "company_1",
    title: "Validate first wedge",
    status: "active",
    priority: 1,
  } satisfies Objective);
  repositories.createKeyResult({
    id: "key_result_1",
    objectiveId: "objective_1",
    title: "Ship proof-backed prototype",
    metricName: "proof_status",
    targetValue: "proof_received",
    currentValue: "not_started",
    status: "active",
  } satisfies KeyResult);
  repositories.createTask({
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
    status: "running",
    riskLevel: "medium",
    position: 0,
  } satisfies Task);
  repositories.createAgentRun({
    id: "agent_run_1",
    taskId: "task_1",
    agentId: "codex",
    status: "running",
    logPath: ".auto-crop/companies/company_1/logs/task_1.log",
    startedAt: "2026-09-21T00:00:00.000Z",
    finishedAt: null,
    executionProfileName: "short",
    requestedTimeoutMs: 180_000,
    effectiveTimeoutMs: 180_000,
    failureReason: null,
    failureMessage: null,
  } satisfies AgentRun);
}
