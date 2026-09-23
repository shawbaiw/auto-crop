import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
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
  /** Resolves once the supervisor has stopped and the worker has been asked to go. */
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

  // Its own connection. Sharing the worker's would tie this process's liveness to the worker's.
  const database = createDatabaseClient(join(stateDir, "state.sqlite"));
  migrate(database);
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

  async function scan(reason: string): Promise<void> {
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

  function startWorker(): void {
    if (stopped) {
      return;
    }
    worker = options.spawnWorker
      ? options.spawnWorker()
      : spawn(process.execPath, [process.argv[1]!, "start"], { stdio: "inherit", env: process.env });
    log(`Supervisor: worker started (pid ${worker.pid ?? "unknown"})`);

    worker.once("exit", (code, signal) => {
      worker = null;
      if (stopped) {
        return;
      }
      // Seen directly, so the tasks it abandoned are reconciled now rather than when their leases
      // expire. This is the whole advantage of being the parent.
      log(`Supervisor: worker exited (code ${code ?? "null"}, signal ${signal ?? "none"}); reconciling its work.`);
      void scan("worker exit");
      restartTimer = setTimeout(startWorker, options.restartDelayMs ?? WORKER_RESTART_DELAY_MS);
      restartTimer.unref?.();
    });
  }

  // Before anything is dispatched: whatever the last run of this system left behind is settled first.
  await scan("startup");
  startWorker();

  const interval = setInterval(() => void scan("interval"), options.scanIntervalMs ?? SUPERVISOR_SCAN_INTERVAL_MS);
  interval.unref?.();
  log(`Supervisor: scanning every ${options.scanIntervalMs ?? SUPERVISOR_SCAN_INTERVAL_MS}ms`);

  return {
    async close(): Promise<void> {
      stopped = true;
      clearInterval(interval);
      if (restartTimer) {
        clearTimeout(restartTimer);
      }
      if (worker) {
        worker.kill("SIGTERM");
      }
      database.close();
    },
  };
}
