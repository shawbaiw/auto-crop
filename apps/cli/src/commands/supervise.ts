import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireSupervisorOwnership } from "./supervisorOwnership";
import { createId } from "@auto-crop/core";
import { createDatabaseClient, createRepositories, migrate, Supervisor } from "@auto-crop/server";

/**
 * How often the supervisor sweeps for work the worker cannot report itself.
 *
 * Short enough that a lost worker's tasks are recovered promptly, long enough that an idle machine
 * is not doing constant database work. The worker's own exit is not waited for on this clock — that
 * is observed directly — so this covers the cases the parent cannot see: a wedged event loop, a
 * worker on another machine, an event whose delivery failed and is due for another try.
 */
const SUPERVISOR_SCAN_INTERVAL_MS = 15_000;

/** How long to wait before restarting a worker that exited, so a crash loop does not spin. */
const WORKER_RESTART_DELAY_MS = 2_000;

export type SuperviseOptions = {
  projectRoot: string;
  /** How to start the worker. Injected so tests can supervise something that is not a real server. */
  spawnWorker?: () => ChildProcess;
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
    supervisorId: `supervisor-${process.pid}-${createId("run")}`,
    createId,
    log,
  });

  let stopped = false;
  let worker: ChildProcess | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let scanning = false;
  let scanFinished: Promise<void> = Promise.resolve();

  async function performScan(reason: string): Promise<void> {
    if (scanning || stopped) {
      return;
    }
    scanning = true;
    try {
      const result = await supervisor.scanOnce();
      if (result.reconciledTaskIds.length > 0 || result.deliveredEventIds.length > 0 || result.deadLetteredEventIds.length > 0) {
        log(
          `Supervisor scan (${reason}): recovered=${result.reconciledTaskIds.length} delivered=${result.deliveredEventIds.length} `
          + `retrying=${result.failedEventIds.length} deadLettered=${result.deadLetteredEventIds.length}`,
        );
      }
    } catch (error) {
      // A supervisor that throws is a supervisor that has stopped supervising.
      log(`Supervisor scan failed: ${(error as Error).message}`);
    } finally {
      scanning = false;
    }
  }

  function scan(reason: string): Promise<void> {
    if (!scanning) scanFinished = performScan(reason);
    return scanFinished;
  }

  function startWorker(): void {
    if (stopped) {
      return;
    }
    worker = options.spawnWorker
      ? options.spawnWorker()
      : spawn(process.execPath, [...process.execArgv, fileURLToPath(new URL("../index.ts", import.meta.url)), "__worker"], {
        stdio: ["inherit", "inherit", "inherit", "ipc"],
        env: { ...process.env, INIT_CWD: projectRoot },
      });
    const child = worker;
    if (child.pid) ownership.recordWorker(child.pid);
    child.on("message", (message) => {
      if (message === "worker-ready" && !stopped && child.connected) {
        child.send("worker-start", (error) => {
          if (error) log(`Supervisor: worker handshake failed: ${error.message}`);
        });
      }
    });
    child.once("error", (error) => log(`Supervisor: worker launch failed: ${error.message}`));
    log(`Supervisor: worker started (pid ${worker.pid ?? "unknown"})`);

    child.once("close", (code, signal) => {
      worker = null;
      ownership.recordWorker(null);
      if (stopped) {
        return;
      }
      // Trigger a scan immediately. Associating this exit with a specific owner/run is K3;
      // the current reconciler still applies its existing expiry rules.
      log(`Supervisor: worker exited (code ${code ?? "null"}, signal ${signal ?? "none"}); reconciling its work.`);
      void scan("worker exit");
      restartTimer = setTimeout(startWorker, options.restartDelayMs ?? WORKER_RESTART_DELAY_MS);
    });
  }

  // Attempt startup reconciliation before dispatch; fail-closed reconciliation is tracked by K3.
  await scan("startup");
  try {
    startWorker();
  } catch (error) {
    database.close();
    ownership.close();
    throw error;
  }

  const interval = setInterval(() => void scan("interval"), options.scanIntervalMs ?? SUPERVISOR_SCAN_INTERVAL_MS);

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
            child.once("close", resolve);
            child.kill("SIGTERM");
            const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
            child.once("close", () => clearTimeout(force));
          });
        }
        await scanFinished;
        database.close();
        ownership.close();
      })();
    },
  };
}
