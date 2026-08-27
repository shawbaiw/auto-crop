import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  aiSaasPlaybook,
  createApiServer,
  createClaudeCodeAdapter,
  createCodexAdapter,
  createDatabaseClient,
  createProofCollector,
  createRepositories,
  getDefaultPolicy,
  migrate,
  runSchedulerOnce,
  type AgentAdapter,
  type SchedulerWakeReason,
} from "@auto-crop/server";

export type StartAutoCropOptions = {
  projectRoot: string;
  host?: string;
  port?: number;
  agents?: AgentAdapter[];
  schedulerIntervalMs?: number;
  log?: (line: string) => void;
};

export type StartedAutoCrop = {
  url: string;
  close(): Promise<void>;
};

export async function startAutoCrop(options: StartAutoCropOptions): Promise<StartedAutoCrop> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const log = options.log ?? console.log;
  const schedulerIntervalMs = options.schedulerIntervalMs ?? Number(process.env.AUTO_CROP_SCHEDULER_INTERVAL_MS ?? 5_000);
  const stateDir = join(options.projectRoot, ".auto-crop");
  mkdirSync(stateDir, { recursive: true });

  const database = createDatabaseClient(join(stateDir, "state.sqlite"));
  migrate(database);
  const repositories = createRepositories(database);
  const agents = options.agents ?? [createClaudeCodeAdapter({ log }), createCodexAdapter({ log })];

  for (const agent of agents) {
    const detected = await agent.detect();
    log(`Agent ${agent.name}: ${detected ? "available" : "unavailable"}`);
  }

  let scheduler: ReturnType<typeof startSchedulerLoop> | undefined;
  const apiServer = createApiServer({
    projectRoot: options.projectRoot,
    repositories,
    agents,
    log,
    requestSchedulerWake: (reason) => scheduler?.requestWake(reason),
  });
  scheduler = startSchedulerLoop({
    agents,
    intervalMs: schedulerIntervalMs,
    log,
    projectRoot: options.projectRoot,
    repositories,
    publish: (event) => apiServer.events.publish(event),
  });

  await new Promise<void>((resolve) => {
    apiServer.httpServer.listen(port, host, resolve);
  });

  const address = apiServer.httpServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Unable to determine local server address.");
  }

  const url = `http://${host}:${(address as AddressInfo).port}`;
  log(`Dashboard: ${url}`);

  return {
    url,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        apiServer.httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      scheduler.stop();
      database.close();
    },
  };
}

export function startSchedulerLoop(input: {
  agents: AgentAdapter[];
  intervalMs: number;
  log: (line: string) => void;
  projectRoot: string;
  publish: Parameters<typeof runSchedulerOnce>[0]["emit"];
  repositories: ReturnType<typeof createRepositories>;
}) {
  const workerId = `cli-worker-${process.pid}`;
  const proofCollector = createProofCollector({ proofSchemas: aiSaasPlaybook.proofSchemas });
  let running = false;
  let stopped = false;
  let wakePending = false;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;

  async function tick() {
    if (running || stopped) {
      return;
    }

    running = true;
    wakePending = false;
    try {
      const result = await runSchedulerOnce({
        projectRoot: input.projectRoot,
        repositories: input.repositories,
        adapters: input.agents,
        workerId,
        maxTasks: 1,
        approvalRequired: () => getDefaultPolicy().decisions.run_safe_command === "ask",
        proofCollector,
        emit: (event) => {
          input.log(`Scheduler ${event.type}: ${event.taskId} ${event.message}`);
          input.publish(event);
        },
      });

      if (result.started.length > 0 || result.completed.length > 0 || result.failed.length > 0 || result.blocked.length > 0) {
        input.log(
          `Scheduler tick: started=${result.started.length} completed=${result.completed.length} failed=${result.failed.length} blocked=${result.blocked.length}`,
        );
      }
    } catch (error) {
      input.log(`Scheduler failed: ${(error as Error).message}`);
    } finally {
      running = false;
      if (wakePending && !stopped) {
        scheduleWakeTick();
      }
    }
  }

  function scheduleWakeTick() {
    if (stopped || wakeTimer) {
      return;
    }

    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      void tick();
    }, 0);
  }

  const interval = setInterval(() => void tick(), input.intervalMs);
  void tick();
  input.log(`Scheduler: running every ${input.intervalMs}ms`);

  return {
    requestWake(reason: SchedulerWakeReason) {
      if (stopped) {
        return;
      }

      input.log(`Scheduler wake requested: ${reason}`);
      wakePending = true;
      if (!running) {
        scheduleWakeTick();
      }
    },
    stop() {
      stopped = true;
      clearInterval(interval);
      if (wakeTimer) {
        clearTimeout(wakeTimer);
        wakeTimer = null;
      }
    },
  };
}
