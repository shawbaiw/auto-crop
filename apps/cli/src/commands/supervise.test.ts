import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { recordExecutionEvent } from "@auto-crop/server";
import { openState } from "./fixtures/state";
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

  it.skipIf(process.platform === "win32")("detects a frozen live Worker independently and isolates its surviving writer before replacement", async () => {
    const projectRoot = createTempProjectRoot();
    const { client, repositories } = openState(projectRoot);
    let child: ChildProcess | undefined, writerPid: number | undefined, launches = 0, isolatedBeforeRestart = false;
    const supervisor = await superviseAutoCrop({ projectRoot, scanIntervalMs: 20, restartDelayMs: 20, log: () => undefined,
      spawnWorker: ownerId => {
        launches++;
        if (launches > 1) {
          isolatedBeforeRestart = Boolean(repositories.listWorkspaceClaims()[0]?.isolatedReason);
          return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        }
        child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./fixtures/exitingWorker.ts", import.meta.url)), projectRoot, ownerId, "wedged"], {
          env: { ...process.env, AUTO_CROP_FORCE_AGENT_TIMEOUT_MS: "60" }, stdio: ["ignore", "ignore", "pipe", "ipc"],
        });
        child.on("message", message => { const data = message as { type: string; pid: number }; if (data.type === "writer-started") writerPid = data.pid; });
        return child;
      },
    });
    try {
      await untilTrue(() => Boolean(writerPid));
      process.kill(child!.pid!, "SIGSTOP");
      await untilTrue(() => launches > 1);
      expect(isolatedBeforeRestart).toBe(true);
      expect(repositories.getTask("task_1")?.latestFailureReason).toBe("termination_unconfirmed");
      const events = repositories.listOutboxEvents({ companyId: "company_1" });
      expect(events.some(e => e.type === "execution_suspected")).toBe(true);
      expect(events.some(e => e.type === "execution_stop_requested")).toBe(true);
      expect(events.some(e => e.type === "execution_failed" && e.payload.reason === "worker_lost")).toBe(true);
      process.kill(writerPid!, 0); // The child exit alone did not prove its detached writer stopped.
      expect(repositories.executionBudget.getTask("task_1")).toMatchObject({ consumedMs: 10000, reservedMs: 0 });
    } finally {
      await supervisor.close();
      if (writerPid) { try { process.kill(-writerPid, "SIGKILL"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; } }
      client.close();
    }
  }, 20000);

  it("refuses a second supervisor before spawning, and releases ownership on close", async () => {
    const projectRoot = createTempProjectRoot();
    let launches = 0;
    const options = {
      projectRoot,
      log: () => undefined,
      spawnWorker: () => {
        launches++;
        return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      },
    };
    const first = await superviseAutoCrop(options);
    try {
      await expect(superviseAutoCrop(options)).rejects.toThrow("already running");
      expect(launches).toBe(1);
    } finally {
      await first.close();
    }
    const next = await superviseAutoCrop(options);
    await next.close();
    expect(launches).toBe(2);
  });

  it("the start CLI runs a supervised worker and consumes failures without opening a page", async () => {
    const projectRoot = createTempProjectRoot();
    const { repositories, client } = openState(projectRoot);
    // A settled failure fixture avoids invoking any real model. Delivery must happen after startup.
    repositories.writeTaskStatusUnchecked("task_1", "failed");
    const first = launchCli(projectRoot);
    try {
      await untilTrue(() => first.output().includes("Dashboard:")).catch(() => { throw new Error(first.output()); });
      expect(first.output().match(/Supervisor: worker started/g)).toHaveLength(1);
      const url = first.output().match(/Dashboard: (http:\/\/[^\s]+)/)![1];
      repositories.transaction(() => recordExecutionEvent(repositories, {
        id: "failure_after_start", type: "execution_failed", companyId: "company_1",
        taskId: "task_1", reason: "process_exit", observedAt: new Date().toISOString(),
      }));
      await untilTrue(() => repositories.listRecoveryDecisions("company_1").length === 1, 25_000);
      const response = await fetch(`${url}/api/companies/company_1/execution-events`);
      expect(await response.json()).toMatchObject({ pending: 0, decisions: [{ sourceEventId: "failure_after_start" }] });
      const second = launchCli(projectRoot);
      try {
        await untilTrue(() => second.child.exitCode !== null);
        expect(second.child.exitCode).toBe(1);
        expect(second.output()).toContain("already running");
        expect(second.output()).not.toContain("worker started");
      } finally {
        await stopChild(second.child);
      }
    } finally {
      await stopChild(first.child);
      client.close();
    }
    const next = launchCli(projectRoot);
    try {
      await untilTrue(() => next.output().includes("Dashboard:"));
    } finally {
      await stopChild(next.child);
    }
  }, 40_000);

  it.skipIf(process.platform === "win32")("refuses takeover while an orphan worker lives, then recovers a stale claim", async () => {
    const projectRoot = createTempProjectRoot();
    const first = launchCli(projectRoot);
    let workerPid: number | undefined;
    try {
      await untilTrue(() => first.output().includes("Dashboard:")).catch(() => { throw new Error(first.output()); });
      workerPid = Number(first.output().match(/worker started \(pid (\d+)/)![1]);
      process.kill(workerPid, "SIGSTOP");
      const exited = once(first.child, "exit");
      first.child.kill("SIGKILL");
      await exited;
      const refused = launchCli(projectRoot);
      try {
        await untilTrue(() => refused.child.exitCode !== null);
        expect(refused.output()).toContain("already running");
        expect(refused.output()).not.toContain("worker started");
      } finally {
        await stopChild(refused.child);
      }
      process.kill(workerPid, "SIGKILL");
      await untilTrue(() => {
        try { process.kill(workerPid!, 0); return false; } catch { return true; }
      });
      workerPid = undefined;
      const recovered = launchCli(projectRoot);
      try {
        await untilTrue(() => recovered.output().includes("Dashboard:"));
      } finally {
        await stopChild(recovered.child);
      }
    } finally {
      if (workerPid) { try { process.kill(workerPid, "SIGKILL"); } catch { /* Already exited. */ } }
      await stopChild(first.child);
    }
  }, 30_000);

  it("refuses startup when reconciliation fails, then starts after the fault is removed", async () => {
    const projectRoot = createTempProjectRoot();
    const { repositories, client } = openState(projectRoot);
    repositories.writeTaskStatusUnchecked("task_1", "running");
    repositories.acquireTaskLock("task_1", "old_worker", "2020-01-01T00:00:00.000Z");
    client.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox_events BEGIN SELECT RAISE(ABORT, 'injected reconciliation failure'); END");
    let starts = 0;
    const options = { projectRoot, log: () => undefined, spawnWorker: () => {
      starts++;
      return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    } };
    try {
      await expect(superviseAutoCrop(options)).rejects.toThrow("injected reconciliation failure");
      expect(starts).toBe(0);
      expect(repositories.getTask("task_1")?.status).toBe("running");
      client.exec("DROP TRIGGER fail_outbox");
      const running = await superviseAutoCrop(options);
      await running.close();
      expect(starts).toBe(1);
    } finally { client.close(); }
  });

  it.skipIf(process.platform === "win32").each(["retry", "supervisor_restart", "budget_retry", "budget_supervisor_restart"] as const)("isolates a fresh run after Worker death before PID registration, with %s after a reconciliation failure", async (mode) => {
    const projectRoot = createTempProjectRoot();
    const { repositories, client } = openState(projectRoot);
    const budgetMode = mode.startsWith("budget_");
    let first: ChildProcess | undefined;
    let writerPid: number | undefined;
    let writerPath: string | undefined;
    let owner: string | undefined;
    let starts = 0;
    let replacementSawIsolation = false;
    const logs: string[] = [];
    const options: Parameters<typeof superviseAutoCrop>[0] = {
      projectRoot, scanIntervalMs: 60_000, restartDelayMs: 30, log: (line) => logs.push(line),
      spawnWorker: (ownerId) => {
        starts++;
        if (starts > 1) {
          replacementSawIsolation = repositories.getTask("task_1")?.status === "blocked"
            && repositories.listWorkspaceClaims()[0]?.isolatedReason !== null;
          return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        }
        owner = ownerId;
        first = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./fixtures/exitingWorker.ts", import.meta.url)), projectRoot, ownerId, budgetMode ? "budget" : "observe"], {
          env: { ...process.env, ...(budgetMode ? { AUTO_CROP_FORCE_AGENT_TIMEOUT_MS: "60" } : {}) },
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        });
        first.on("message", (message) => {
          const data = message as { type: string; pid: number; path: string };
          if (data.type === "writer-started") { writerPid = data.pid; writerPath = data.path; }
        });
        return first;
      },
    };
    let supervised = await superviseAutoCrop(options);
    try {
      await untilTrue(() => writerPid !== undefined);
      const run = repositories.listRunningAgentRuns("company_1")[0];
      expect(repositories.listRunningAgentRunsForOwner(owner!)[0].id).toBe(run.id);
      expect(Date.parse(repositories.listTaskLocks()[0].leaseExpiresAt!)).toBeGreaterThan(Date.now());
      // Fail after receiving real exit evidence. Replacement must remain gated, not just delayed.
      client.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox_events BEGIN SELECT RAISE(ABORT, 'exit reconciliation failed'); END");
      first!.send("crash");
      await untilTrue(() => logs.some((line) => line.includes("restart blocked by reconciliation")));
      expect(starts).toBe(1);
      expect(repositories.getTask("task_1")?.status).toBe("running");
      if (mode.endsWith("supervisor_restart")) {
        await expect(supervised.close()).rejects.toThrow("exit reconciliation failed");
      }
      client.exec("DROP TRIGGER fail_outbox");
      if (mode.endsWith("supervisor_restart")) supervised = await superviseAutoCrop(options);
      await untilTrue(() => starts === 2, 3_000);
      expect(replacementSawIsolation).toBe(true);
      expect(repositories.listOpenTaskHolds("task_1").map((hold) => hold.kind)).toEqual(["termination_unconfirmed"]);
      const events = repositories.listOutboxEvents({ companyId: "company_1" }).filter(event => event.type === "execution_failed");
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ runId: run.id, reason: "worker_lost", terminationConfirmed: null });
      expect(repositories.listRecoveryDecisions("company_1").filter(decision => decision.sourceEventId === events[0].id)).toHaveLength(1);
      if (budgetMode) {
        expect(repositories.executionBudget.getRun(run.id)).toMatchObject({ consumed_ms: 10_000, settled: 1, estimated: 1 });
        expect(repositories.executionBudget.ledger(run.id).filter(row => row.kind === "settled")).toHaveLength(1);
      }
      await untilTrue(() => { try { return statSync(join(writerPath!, "still-writing.txt")).size > 0; } catch { return false; } });
      const before = statSync(join(writerPath!, "still-writing.txt")).size;
      await untilTrue(() => statSync(join(writerPath!, "still-writing.txt")).size > before);
      // Even another Task cannot take this directory, long after the original lease expires.
      expect(repositories.acquireWorkspaceClaim({
        workspacePath: writerPath!, taskId: "other_task", runId: "other_run", ownerId: "other_worker", ownerEpoch: 1,
        acquiredAt: "2099-01-01T00:00:00.000Z", leaseExpiresAt: "2099-01-01T01:00:00.000Z", now: "2099-01-01T00:00:00.000Z",
      })).toBe(false);
    } finally {
      if (writerPid) { try { process.kill(-writerPid, "SIGKILL"); } catch { /* Already stopped. */ } }
      client.exec("DROP TRIGGER IF EXISTS fail_outbox");
      await supervised.close();
      client.close();
    }
  }, 25_000);

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

function createTempProjectRoot(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-supervise-"));
  createdDirs.push(projectRoot);
  mkdirSync(join(projectRoot, ".auto-crop"), { recursive: true });
  return projectRoot;
}

function launchCli(projectRoot: string) {
  const entry = fileURLToPath(new URL("../index.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", entry, "start"], {
    cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
    env: { ...process.env, INIT_CWD: projectRoot, AUTO_CROP_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  return { child, output: () => output };
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 7_000);
  try { await exited; } finally { clearTimeout(timeout); }
}
