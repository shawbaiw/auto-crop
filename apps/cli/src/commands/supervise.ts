import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireSupervisorOwnership } from "./supervisorOwnership";
import { createId } from "@auto-crop/core";
import { createDatabaseClient, createRepositories, migrate, Supervisor, executionBudgetFromEnvironment } from "@auto-crop/server";

/**
 * How often the supervisor sweeps for work the worker cannot report itself.
 *
 * Short enough that a lost worker's tasks are recovered promptly, long enough that an idle machine
 * is not doing constant database work. The worker's own exit is not waited for on this clock — that
 * is observed directly. This periodic scan handles legacy deadline reconciliation and events due
 * for another delivery.
 * Budget-policy runs also receive independent liveness assessment and containment.
 */
const SUPERVISOR_SCAN_INTERVAL_MS = 5_000;

/** How long to wait before restarting a worker that exited, so a crash loop does not spin. */
const WORKER_RESTART_DELAY_MS = 2_000;

export type SuperviseOptions = {
  projectRoot: string;
  /** How to start the worker. Injected so tests can supervise something that is not a real server. */
  spawnWorker?: (ownerId: string) => ChildProcess;
  scanIntervalMs?: number;
  restartDelayMs?: number;
  log?: (line: string) => void;
};

export type SupervisedAutoCrop = {
  /** Resolves after the worker exits and the local launch claim is released. */
  close(): Promise<void>;
};

/**
 * Run the worker as a child, and watch it from here.
 *
 * The point of the separation is that this process shares nothing with the one doing the work: its
 * own database connection, its own event loop, no dependency on the worker's HTTP API. A supervisor
 * that asked a wedged worker whether it was healthy would be asking the patient (ADR 0037).
 *
 * What it does not cover is stated rather than implied: if this process or the machine goes down,
 * nothing is watching. That needs a system process manager, and the supervisor is a module precisely
 * so it can be driven by one later.
 */
export async function superviseAutoCrop(options: SuperviseOptions): Promise<SupervisedAutoCrop> {
  executionBudgetFromEnvironment(); // Fail before starting any Worker if opt-in configuration is invalid.
  const log = options.log ?? console.log;
  const stateDir = join(options.projectRoot, ".auto-crop");
  mkdirSync(stateDir, { recursive: true });

  const projectRoot = realpathSync(options.projectRoot);
  const ownership = acquireSupervisorOwnership(join(stateDir, "supervisor.sqlite"));

  // Its own connection. Sharing the worker's would tie this process's liveness to the worker's.
  const database = (() => {
    let connection: ReturnType<typeof createDatabaseClient> | undefined;
    try {
      connection = createDatabaseClient(join(stateDir, "state.sqlite"));
      migrate(connection);
      return connection;
    } catch (error) {
      connection?.close();
      ownership.close();
      throw error;
    }
  })();
  const repositories = createRepositories(database);
  const supervisor = new Supervisor({
    repositories,
    probeOwner: (ownerId) => {
      if (ownerId === activeOwnerId && worker?.connected) worker.send({ type: "worker-probe" }, error => {
        if (error) log(`Supervisor probe failed: ${error.message}`);
      });
    },
    stopOwner: (ownerId) => {
      const child = worker;
      if (!child || ownerId !== activeOwnerId || stoppingOwner === ownerId) return;
      stoppingOwner = ownerId;
      // Stop only our recorded child. Detached Agent descendants remain isolated by exit reconciliation.
      const force = setTimeout(() => { if (worker === child) child.kill("SIGKILL"); }, 5_000);
      child.once("exit", () => clearTimeout(force));
      child.kill("SIGTERM");
    },
    supervisorId: `supervisor-${process.pid}-${createId("run")}`,
    createId,
    log,
  });

  let stoppingOwner: string | null = null;
  let stopped = false;
  let worker: ChildProcess | null = null;
  let activeOwnerId: string | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let scanning = false;
  let scanFinished: Promise<void> = Promise.resolve();

  function scan(reason: string): Promise<void> {
    // Exit scans queue behind an in-flight scan instead of silently disappearing behind its guard.
    scanFinished = scanFinished.catch(() => undefined).then(async () => {
      scanning = true;
      try {
        const exitedOwners = ownership.pendingWorkers().filter((id) => id !== activeOwnerId);
        const result = await supervisor.scanOnce(exitedOwners);
        for (const ownerId of exitedOwners) ownership.reconciledWorker(ownerId);
        if (result.reconciledTaskIds.length > 0 || result.deliveredEventIds.length > 0 || result.deadLetteredEventIds.length > 0) {
          log(`Supervisor scan (${reason}): recovered=${result.reconciledTaskIds.length} delivered=${result.deliveredEventIds.length} `
            + `retrying=${result.failedEventIds.length} deadLettered=${result.deadLetteredEventIds.length}`);
        }
      } finally { scanning = false; }
    });
    return scanFinished;
  }

  function scheduleRestart(): void {
    if (stopped || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      void restart();
    }, options.restartDelayMs ?? WORKER_RESTART_DELAY_MS);
  }

  async function restart(): Promise<void> {
    try {
      await scan("worker exit");
      if (!stopped && !restartTimer) {
        restartTimer = setTimeout(() => {
          restartTimer = null;
          try { startWorker(); }
          catch (error) {
            log(`Supervisor: worker restart failed: ${(error as Error).message}`);
            scheduleRestart();
          }
        }, options.restartDelayMs ?? WORKER_RESTART_DELAY_MS);
      }
    } catch (error) {
      log(`Supervisor: restart blocked by reconciliation: ${(error as Error).message}`);
      scheduleRestart();
    }
  }

  function startWorker(): void {
    if (stopped || worker) return;
    const ownerId = createId("cli-worker");
    stoppingOwner = null;
    ownership.beginWorker(ownerId);
    activeOwnerId = ownerId;
    try {
      worker = options.spawnWorker
        ? options.spawnWorker(ownerId)
        : spawn(process.execPath, [...process.execArgv, fileURLToPath(new URL("../index.ts", import.meta.url)), "__worker"], {
          stdio: ["inherit", "inherit", "inherit", "ipc"],
          env: { ...process.env, INIT_CWD: projectRoot },
        });
      const child = worker;
      if (child.pid) ownership.recordWorker(child.pid);
      child.on("message", (message) => {
        if (message === "worker-ready" && !stopped && child.connected) {
          child.send({ type: "worker-start", ownerId }, (error) => {
            if (error) log(`Supervisor: worker handshake failed: ${error.message}`);
          });
        }
      });
      child.once("error", (error) => log(`Supervisor: worker launch failed: ${error.message}`));
      log(`Supervisor: worker started (pid ${child.pid ?? "unknown"}, owner ${ownerId})`);
      // Use exit, not close: an Agent inheriting a pipe can keep close pending after Worker death.
      const exited = (code: number | null, signal: NodeJS.Signals | null) => {
        if (worker !== child) return;
        worker = null;
        activeOwnerId = null;
        ownership.recordWorker(null);
        log(`Supervisor: worker exited (code ${code ?? "null"}, signal ${signal ?? "none"}); reconciling its work.`);
        if (!stopped) void restart();
      };
      child.once("exit", exited);
      // A failed spawn emits error/close without exit.
      child.once("close", exited);
    } catch (error) {
      activeOwnerId = null;
      // The production child has not received its IPC start permission on this failure path.
      worker?.kill("SIGKILL");
      worker = null;
      throw error;
    }
  }

  try {
    await scan("startup");
    startWorker();
  } catch (error) {
    database.close();
    ownership.close();
    throw error;
  }

  const interval = setInterval(() => {
    if (!scanning && !stopped) void scan("interval").catch((error) => log(`Supervisor scan failed: ${(error as Error).message}`));
  }, options.scanIntervalMs ?? SUPERVISOR_SCAN_INTERVAL_MS);
  log(`Supervisor: scanning every ${options.scanIntervalMs ?? SUPERVISOR_SCAN_INTERVAL_MS}ms`);

  let closing: Promise<void> | undefined;
  return {
    close(): Promise<void> {
      return closing ??= (async () => {
        stopped = true;
        clearInterval(interval);
        if (restartTimer) clearTimeout(restartTimer);
        const child = worker;
        if (child) {
          await new Promise<void>((resolve) => {
            const done = () => { clearTimeout(force); resolve(); };
            const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
            child.once("exit", done);
            child.once("close", done);
            child.kill("SIGTERM");
          });
        }
        try {
          await scan("shutdown");
        } finally {
          // Pending owner rows survive a failed scan, even after the launch claim is released.
          database.close();
          ownership.close();
        }
      })();
    },
  };
}
