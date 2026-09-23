import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Company, Department, KeyResult, Objective, Task } from "@auto-crop/core";
import { createDatabaseClient, createRepositories, migrate } from "@auto-crop/server";
import { superviseAutoCrop } from "./supervise";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The supervisor against a worker that really dies (execution-health P3).
 *
 * The worker here is a plain node process rather than a server, because what is being tested is the
 * supervision, not the work: that a process outside the worker notices its death, recovers what it
 * abandoned, and starts a replacement. A fake that resolved a promise instead of exiting would test
 * none of that.
 */
describe("superviseAutoCrop", () => {
  const untilTrue = async (predicate: () => boolean, timeoutMs = 15_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Timed out waiting for the supervised system to settle.");
  };

  it("outlives its worker, recovers the task it abandoned, and starts a replacement", async () => {
    const projectRoot = createTempProjectRoot();
    const { repositories, client } = openState(projectRoot);
    // The state a worker killed mid-dispatch leaves behind: a task that says it is executing, a lock
    // whose lease nobody is renewing, and no run to account for it.
    repositories.writeTaskStatusUnchecked("task_1", "running");
    repositories.acquireTaskLock("task_1", "dead_worker", "2020-01-01T00:00:00.000Z", {
      expiresAt: "2020-01-01T00:01:00.000Z",
      now: "2020-01-01T00:00:00.000Z",
    });

    const logs: string[] = [];
    const workerPids: number[] = [];
    const supervised = await superviseAutoCrop({
      projectRoot,
      scanIntervalMs: 250,
      restartDelayMs: 100,
      log: (line) => logs.push(line),
      spawnWorker: () => {
        // A worker that exits by itself, twice, so the restart is observable.
        const child = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(1), 300)"], { stdio: "ignore" });
        workerPids.push(child.pid!);
        return child;
      },
    });

    try {
      // The supervisor is still running after the worker it started has gone…
      await untilTrue(() => workerPids.length >= 2);
      expect(logs.some((line) => line.includes("worker exited"))).toBe(true);
      // …and the task the dead worker abandoned has a real way forward rather than saying "running".
      await untilTrue(() => repositories.getTask("task_1")?.status === "failed");
      expect(repositories.getTask("task_1")).toMatchObject({ latestFailureReason: "worker_lost" });
      expect(repositories.listOpenTaskHolds("task_1").map((hold) => hold.kind)).toEqual(["runtime_interrupted"]);
      expect(repositories.listTaskLocks()).toEqual([]);

      // And it said so durably, to a consumer that acted on it — one decision, not one per scan.
      await untilTrue(() => repositories.listRecoveryDecisions("company_1").length > 0);
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(repositories.listRecoveryDecisions("company_1")).toHaveLength(1);
      expect(repositories.listOutboxEvents({ companyId: "company_1", pendingOnly: true })).toEqual([]);
    } finally {
      await supervised.close();
      client.close();
    }
  }, 40_000);

  it("reconciles what the last run left behind before starting a worker at all", async () => {
    const projectRoot = createTempProjectRoot();
    const { repositories, client } = openState(projectRoot);
    repositories.writeTaskStatusUnchecked("task_1", "running");
    repositories.acquireTaskLock("task_1", "dead_worker", "2020-01-01T00:00:00.000Z", {
      expiresAt: "2020-01-01T00:01:00.000Z",
      now: "2020-01-01T00:00:00.000Z",
    });
    let workerStartedWhileTaskWasRunning: boolean | null = null;

    const supervised = await superviseAutoCrop({
      projectRoot,
      scanIntervalMs: 60_000,
      log: () => undefined,
      spawnWorker: () => {
        // Whatever the worker would dispatch, the leftovers are already settled by now.
        workerStartedWhileTaskWasRunning ??= repositories.getTask("task_1")?.status === "running";
        return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      },
    });

    try {
      expect(workerStartedWhileTaskWasRunning).toBe(false);
      expect(repositories.getTask("task_1")?.status).toBe("failed");
    } finally {
      await supervised.close();
      client.close();
    }
  }, 30_000);
});

function openState(projectRoot: string) {
  const client = createDatabaseClient(join(projectRoot, ".auto-crop", "state.sqlite"));
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

function createTempProjectRoot(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-supervise-"));
  createdDirs.push(projectRoot);
  mkdirSync(join(projectRoot, ".auto-crop"), { recursive: true });
  return projectRoot;
}
