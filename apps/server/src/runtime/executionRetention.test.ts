import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@auto-crop/core";
import { openState } from "./fixtures/budgetState";
import {
  DEFAULT_RETENTION_POLICY, retentionPolicyFromEnvironment, runDueRetentionSweep, sweepExecutionRetention,
  type RetentionPolicy,
} from "./executionRetention";
import { summarizeRunActivity } from "./executionObservation";
import { RecoveryCoordinator } from "./recoveryCoordinator";
import { drainAutomaticRecoveries } from "./automaticRecovery";
import { runSchedulerOnce } from "./scheduler";
import { Supervisor } from "./supervisor";
import type { AgentAdapter } from "../adapters/types";
import { DEFAULT_LAUNCH_POLICY, type LaunchPlan } from "../adapters/launchPolicy";
import { createDatabaseClient } from "../db/client";
import { migrate } from "../db/schema";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-08T00:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const cleanup: Array<() => void> = [];
afterEach(() => { vi.unstubAllEnvs(); for (const close of cleanup.splice(0).reverse()) close(); });

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "auto-crop-retention-")));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".auto-crop"));
  const { client, repositories: r } = openState(root);
  cleanup.push(() => client.close());
  const exec = (sql: string, ...values: Array<string | number | null>) => client.prepare(sql).run(...values);
  const count = (sql: string, ...values: string[]) => (client.prepare(sql).get(...values) as { n: number }).n;

  function task(id: string): string {
    r.createTask({ ...r.getTask("task_1")!, id, position: 0, workspacePath: join(root, id) } satisfies Task);
    return id;
  }

  /** A finished run with two invocations of activity, a delivered+decided event and metering rows. */
  function run(id: string, input: { taskId?: string; status?: string; finishedAt?: string | null } = {}) {
    const taskId = input.taskId ?? task(`task_${id}`);
    const finishedAt = input.finishedAt === undefined ? ago(40 * DAY) : input.finishedAt;
    const startedAt = finishedAt ? new Date(Date.parse(finishedAt) - 60_000).toISOString() : ago(DAY);
    exec(`INSERT INTO agent_runs (id, task_id, agent_id, status, log_path, started_at, finished_at)
      VALUES (?, ?, 'codex', ?, 'log', ?, ?)`, id, taskId, input.status ?? "failed", startedAt, finishedAt);
    let seq = 0;
    for (const [phase, offset] of [["preparing_brief", 0], ["executing", 20_000]] as const) {
      const invocationId = `${id}:${phase}`;
      const start = Date.parse(startedAt) + offset;
      exec(`INSERT INTO run_invocations (id, run_id, phase, started_at, ended_at, end_reason) VALUES (?, ?, ?, ?, ?, 'exit')`,
        invocationId, id, phase, new Date(start).toISOString(), new Date(start + 15_000).toISOString());
      for (const [channel, from, to] of [["stdout", 1_000, 3_000], ["stderr", 2_000, 4_000], ["stdout", 9_000, 10_000]] as const) {
        seq += 1;
        exec(`INSERT INTO run_activity (id, run_id, invocation_id, seq, window_started_at, observed_at, phase, channel, bytes, max_gap_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, `${invocationId}:${seq}`, id, invocationId, seq,
          new Date(start + from).toISOString(), new Date(start + to).toISOString(), phase, channel, 10 * seq, 500);
      }
    }
    exec("INSERT OR IGNORE INTO task_budgets (task_id, authorized_ms) VALUES (?, 600000)", taskId);
    exec(`INSERT INTO run_budgets (run_id, task_id, owner_epoch, reserved_ms, consumed_ms, settled, estimated, seq)
      VALUES (?, ?, 1, 60000, 45000, 1, 0, 4)`, id, taskId);
    for (const [seqNo, kind] of [[0, "reserved"], [1, "consumed"], [2, "consumed"], [3, "budget_review"], [4, "settled"]] as const) {
      exec(`INSERT INTO budget_ledger (run_id, seq, kind, consumed_ms, reserved_ms, estimated, recorded_at)
        VALUES (?, ?, ?, ?, 60000, 0, ?)`, id, seqNo, kind, seqNo * 10_000, startedAt);
    }
    event(`${id}:event`, { runId: id, taskId, deliveredAt: finishedAt ?? ago(DAY) });
    return { id, taskId };
  }

  function event(id: string, input: { runId?: string | null; taskId?: string | null; deliveredAt?: string | null;
    deadLetteredAt?: string | null; decided?: boolean }) {
    exec(`INSERT INTO outbox_events (id, version, type, company_id, task_id, run_id, payload, created_at, attempts, delivered_at, dead_lettered_at)
      VALUES (?, 1, 'execution_failed', 'company_1', ?, ?, '{"reason":"agent_failed"}', ?, 1, ?, ?)`,
    id, input.taskId ?? null, input.runId ?? null, ago(41 * DAY), input.deliveredAt ?? null, input.deadLetteredAt ?? null);
    if (input.decided !== false) {
      exec(`INSERT INTO recovery_decisions (id, source_event_id, company_id, task_id, decision, reason, created_at)
        VALUES (?, ?, 'company_1', ?, 'no_action', 'test', ?)`, `decision:${id}`, id, input.taskId ?? null, ago(41 * DAY));
    }
  }

  const sweep = (policy: Partial<RetentionPolicy> = {}) =>
    sweepExecutionRetention({ repositories: r, policy: { ...DEFAULT_RETENTION_POLICY, ...policy }, now: () => NOW });
  const activity = (runId: string) => count("SELECT COUNT(*) AS n FROM run_activity WHERE run_id = ?", runId);
  const invocations = (runId: string) => count("SELECT COUNT(*) AS n FROM run_invocations WHERE run_id = ?", runId);
  const events = (id: string) => count("SELECT COUNT(*) AS n FROM outbox_events WHERE id = ?", id);
  const ledgerKinds = (runId: string) => (client.prepare("SELECT kind FROM budget_ledger WHERE run_id = ? ORDER BY seq")
    .all(runId) as Array<{ kind: string }>).map((row) => row.kind);
  return { root, client, r, exec, task, run, event, sweep, activity, invocations, events, ledgerKinds };
}

describe("execution retention", () => {
  it("replaces old activity windows with the statistics they produced, and leaves recent runs alone", () => {
    const f = fixture();
    const old = f.run("run_old");
    const recent = f.run("run_recent", { finishedAt: ago(2 * DAY) });
    const before = f.r.listRunInvocations(old.id).map((invocation) => summarizeRunActivity({
      activity: f.r.listRunActivity(old.id).filter((row) => row.invocationId === invocation.id),
      startedAt: invocation.startedAt, until: invocation.endedAt!,
    }));

    const result = f.sweep();

    expect(result).toMatchObject({ compactedInvocations: 2, deletedActivityRows: 6, truncated: false, overCapacity: [] });
    expect(f.activity(old.id)).toBe(0);
    expect(f.r.listRunInvocations(old.id).map((invocation) => invocation.activitySummary?.stats)).toEqual(before);
    expect(before[0]).toMatchObject({ firstActivityAfterMs: 1_000, longestGapMs: 5_000, bytesByChannel: { stdout: 40, stderr: 20 } });
    expect(f.activity(recent.id)).toBe(6);
    expect(f.r.listRunInvocations(recent.id).every((invocation) => !invocation.activitySummary)).toBe(true);
  });

  it("drops intermediate metering of settled runs without changing any Task's cumulative budget", () => {
    const f = fixture();
    const old = f.run("run_old");
    const budgetBefore = f.r.executionBudget.getTask(old.taskId);

    expect(f.sweep().deletedLedgerRows).toBe(2);

    expect(f.ledgerKinds(old.id)).toEqual(["reserved", "budget_review", "settled"]);
    expect(f.r.executionBudget.getTask(old.taskId)).toEqual(budgetBefore);
    expect(f.r.executionBudget.taskUsage(old.taskId)).toMatchObject({ consumedMs: 45_000 });
  });

  it("drops delivered, decided events but keeps the decisions that make redelivery harmless", () => {
    const f = fixture();
    const old = f.run("run_old");
    f.event("orphan_event", { deliveredAt: ago(40 * DAY) });

    expect(f.sweep().deletedEvents).toBe(2);

    expect(f.events(`${old.id}:event`) + f.events("orphan_event")).toBe(0);
    expect(f.r.listRecoveryDecisions("company_1").map((decision) => decision.sourceEventId).sort())
      .toEqual(["orphan_event", `${old.id}:event`]);
  });

  it("removes invocation rows only after their activity is gone and their own retention has passed", () => {
    const f = fixture();
    const ancient = f.run("run_ancient", { finishedAt: ago(200 * DAY) });
    const old = f.run("run_old");

    expect(f.sweep().deletedInvocations).toBe(2);
    expect(f.invocations(ancient.id)).toBe(0);
    expect(f.invocations(old.id)).toBe(2);
  });

  describe("never touches history a live mechanism still reads", () => {
    const cases: Array<[string, (f: ReturnType<typeof fixture>, run: { id: string; taskId: string }) => void]> = [
      ["a run that is still running", (f, run) => f.exec("UPDATE agent_runs SET status = 'running' WHERE id = ?", run.id)],
      ["a run with no finish time", (f, run) => f.exec("UPDATE agent_runs SET finished_at = NULL WHERE id = ?", run.id)],
      ["a run still holding its task lock", (f, run) => f.exec(
        "INSERT INTO task_locks (task_id, owner_id, acquired_at, run_id) VALUES (?, 'owner', ?, ?)", run.taskId, ago(DAY), run.id)],
      ["a run whose workspace is isolated pending termination", (f, run) => f.exec(
        `INSERT INTO workspace_claims (workspace_path, task_id, run_id, owner_id, acquired_at, isolated_reason)
         VALUES ('/w', ?, ?, 'owner', ?, 'termination_unconfirmed')`, run.taskId, run.id, ago(DAY))],
      ["a run whose budget is not settled", (f, run) => f.exec("UPDATE run_budgets SET settled = 0 WHERE run_id = ?", run.id)],
      ["the source of a pending automatic recovery", (f, run) => f.exec(
        `INSERT INTO execution_recoveries (source_event_id, task_id, source_run_id, due_at, state, manifest)
         VALUES (?, ?, ?, ?, 'pending', '{}')`, `${run.id}:event`, run.taskId, run.id, ago(DAY))],
      ["the latest run of a Task with an open Hold", (f, run) => f.exec(
        `INSERT INTO task_holds (id, company_id, task_id, kind, resolver, reason, opened_at)
         VALUES ('hold_1', 'company_1', ?, 'runtime_interrupted', 'founder', 'interrupted', ?)`, run.taskId, ago(DAY))],
    ];

    it.each(cases)("%s", (_name, protect) => {
      const f = fixture();
      const run = f.run("run_protected");
      protect(f, run);

      f.sweep({ maxActivityRows: 1, maxInvocationRows: 1, maxOutboxRows: 1, invocationMs: 30 * DAY, activityMs: 1, ledgerMs: 1 });

      expect(f.activity(run.id)).toBe(6);
      expect(f.invocations(run.id)).toBe(2);
      expect(f.ledgerKinds(run.id)).toHaveLength(5);
    });

    it("an earlier run of a Task with an open Hold is not protected by it", () => {
      const f = fixture();
      const earlier = f.run("run_earlier");
      f.run("run_latest", { taskId: earlier.taskId });
      f.exec(`INSERT INTO task_holds (id, company_id, task_id, kind, resolver, reason, opened_at)
        VALUES ('hold_1', 'company_1', ?, 'runtime_interrupted', 'founder', 'interrupted', ?)`, earlier.taskId, ago(DAY));

      f.sweep();

      expect(f.activity(earlier.id)).toBe(0);
      expect(f.activity("run_latest")).toBe(6);
    });

    const eventCases: Array<[string, Parameters<ReturnType<typeof fixture>["event"]>[1]]> = [
      ["an undelivered event", { deliveredAt: null }],
      ["a dead-lettered event", { deliveredAt: null, deadLetteredAt: ago(40 * DAY) }],
      ["a delivered event with no recorded decision", { deliveredAt: ago(40 * DAY), decided: false }],
    ];
    it.each(eventCases)("%s", (_name, input) => {
      const f = fixture();
      f.event("kept", input);
      f.sweep({ maxOutboxRows: 1, deliveredEventMs: 1 });
      expect(f.events("kept")).toBe(1);
    });

    it("an event about a run that is not over, even when delivered", () => {
      const f = fixture();
      const run = f.run("run_live");
      f.exec("UPDATE agent_runs SET status = 'running' WHERE id = ?", run.id);
      f.sweep({ deliveredEventMs: 1 });
      expect(f.events(`${run.id}:event`)).toBe(1);
    });
  });

  it("thins the oldest eligible history first when a table is over its ceiling, but never the newest hour", () => {
    const f = fixture();
    const older = f.run("run_older", { finishedAt: ago(3 * DAY) });
    const newer = f.run("run_newer", { finishedAt: ago(2 * DAY) });
    const fresh = f.run("run_fresh", { finishedAt: ago(10 * 60 * 1000) });

    const result = f.sweep({ maxActivityRows: 12, batchSize: 1 });

    expect(f.activity(older.id)).toBe(0);
    expect(f.activity(newer.id)).toBe(6);
    expect(f.activity(fresh.id)).toBe(6);
    expect(result).toMatchObject({ remaining: { activityRows: 12 }, overCapacity: [] });

    const tight = f.sweep({ maxActivityRows: 1 });
    expect(f.activity(newer.id)).toBe(0);
    expect(f.activity(fresh.id)).toBe(6);
    expect(tight.overCapacity).toEqual(["activityRows"]);
  });

  it("works in short batches and resumes where a truncated sweep stopped", () => {
    const f = fixture();
    for (const id of ["run_a", "run_b", "run_c"]) f.run(id);

    const first = f.sweep({ batchSize: 1, maxBatches: 2 });
    expect(first).toMatchObject({ truncated: true, batches: 2, compactedInvocations: 2 });

    let sweeps = 1;
    while (f.sweep({ batchSize: 1, maxBatches: 2 }).truncated) sweeps += 1;
    expect(sweeps).toBeGreaterThan(1);
    for (const id of ["run_a", "run_b", "run_c"]) {
      expect(f.activity(id)).toBe(0);
      expect(f.events(`${id}:event`)).toBe(0);
    }
  });

  it("sweeps at most once per interval, records the outcome, and reports failures instead of throwing", () => {
    const f = fixture();
    f.run("run_old");
    const policy = { ...DEFAULT_RETENTION_POLICY, sweepIntervalMs: 60 * 60 * 1000 };
    const lines: string[] = [];

    const first = runDueRetentionSweep({ repositories: f.r, policy, now: () => NOW, log: (line) => lines.push(line) });
    expect(first?.deletedActivityRows).toBe(6);
    expect(f.r.executionRetention.lastSweep()).toEqual(first);
    expect(lines.at(-1)).toMatch(/removed \d+ rows/);
    expect(runDueRetentionSweep({ repositories: f.r, policy, now: () => new Date(NOW.getTime() + 60_000) })).toBeNull();

    vi.spyOn(f.r.executionRetention, "compactableInvocations").mockImplementation(() => { throw new Error("disk I/O error"); });
    const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    const failed = runDueRetentionSweep({ repositories: f.r, policy, now: () => later, log: (line) => lines.push(line) });
    expect(failed).toMatchObject({ error: "disk I/O error", remaining: null });
    expect(f.r.executionRetention.lastSweep()).toMatchObject({ error: "disk I/O error" });
    expect(lines.at(-1)).toMatch(/failed \(disk I\/O error\)/);

    expect(runDueRetentionSweep({ repositories: f.r, policy: null, now: () => later })).toBeNull();
  });

  it("is on by default, can be turned off, and refuses invalid configuration", () => {
    expect(retentionPolicyFromEnvironment({})).toEqual(DEFAULT_RETENTION_POLICY);
    expect(retentionPolicyFromEnvironment({ AUTO_CROP_RETENTION: "off" })).toBeNull();
    expect(retentionPolicyFromEnvironment({ AUTO_CROP_RETENTION_JSON: JSON.stringify({ activityMs: DAY }) }))
      .toMatchObject({ activityMs: DAY, invocationMs: DEFAULT_RETENTION_POLICY.invocationMs });
    expect(() => retentionPolicyFromEnvironment({ AUTO_CROP_RETENTION: "forever" })).toThrow(/off or retention-v1/);
    expect(() => retentionPolicyFromEnvironment({ AUTO_CROP_RETENTION_JSON: '{"keepMs":1}' })).toThrow(/Unknown retention/);
    expect(() => retentionPolicyFromEnvironment({ AUTO_CROP_RETENTION_JSON: '{"activityMs":0}' })).toThrow(/positive safe integer/);
    expect(() => retentionPolicyFromEnvironment({ AUTO_CROP_RETENTION_JSON: '{"activityMs":1.5}' })).toThrow(/positive safe integer/);
    expect(() => retentionPolicyFromEnvironment({ AUTO_CROP_RETENTION_JSON: '[]' })).toThrow(/JSON object/);
    expect(() => retentionPolicyFromEnvironment({ AUTO_CROP_RETENTION_JSON: JSON.stringify({ invocationMs: DAY, activityMs: 2 * DAY }) }))
      .toThrow(/invocationMs/);
  });

  it("adds the summary columns to a database created before retention", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "auto-crop-retention-legacy-")));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const client = createDatabaseClient(join(root, "state.sqlite"));
    cleanup.push(() => client.close());
    client.exec(`CREATE TABLE run_invocations (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, phase TEXT NOT NULL,
      started_at TEXT NOT NULL, ended_at TEXT, end_reason TEXT)`);
    client.exec("INSERT INTO run_invocations VALUES ('legacy', 'run', 'executing', '2026-01-01T00:00:00.000Z', NULL, NULL)");

    migrate(client);
    migrate(client);

    const columns = (client.prepare("PRAGMA table_info(run_invocations)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(["activity_compacted_at", "longest_gap_ms", "stdout_bytes"]));
    expect(client.prepare("SELECT activity_compacted_at FROM run_invocations WHERE id = 'legacy'").get()).toEqual({ activity_compacted_at: null });
  });
});

describe("execution retention with a real failed run", () => {
  async function failedRun() {
    const f = fixture();
    mkdirSync(f.r.getTask("task_1")!.workspacePath!, { recursive: true });
    vi.stubEnv("AUTO_CROP_FORCE_AGENT_TIMEOUT_MS", "60");
    const adapter: AgentAdapter = { id: "codex", name: "fixture", capabilities: ["code"], contractCapabilities: ["structured_execution_brief"], detect: async () => true,
      run: async () => ({ status: "failed", stdout: "", stderr: "connection closed", exitCode: 1,
        failureReason: "agent_failed", terminationConfirmed: true }) };
    adapter.launchPlan = async (): Promise<LaunchPlan> => ({ policy: DEFAULT_LAUNCH_POLICY,
      support: { adapterId: "codex", isolationLevel: "strong", supportedFlags: [], missingFlags: [], warnings: [] } });
    await runSchedulerOnce({ projectRoot: f.root, repositories: f.r, adapters: [adapter], workerId: "owner", maxTasks: 1,
      approvalRequired: () => false, emit: () => undefined, proofCollector: () => [],
      executionBudget: { runHardMs: 5000, taskTotalMs: 7000, briefMs: 1000, repairMs: 1000, finalizeMs: 1000, checkpointMs: 60, persistMs: 20 } });
    const event = f.r.listOutboxEvents().find((e) => e.type === "execution_failed")!;
    expect(event).toBeDefined();
    return { ...f, event, runId: event.runId! };
  }

  it("keeps a pending recovery's source event and invocations under full pressure, so the recovery still fires", async () => {
    const f = await failedRun();
    const coordinator = new RecoveryCoordinator({ repositories: f.r, mode: "brief-only-v1" });
    expect(coordinator.consume(f.event).decision.kind).toBe("scheduled");
    f.r.markOutboxEventDelivered(f.event.id, new Date().toISOString());
    const dueAt = new Date(f.r.executionRecovery.get("task_1")!.dueAt);

    sweepExecutionRetention({ repositories: f.r, now: () => new Date(dueAt.getTime() + 365 * DAY),
      policy: { ...DEFAULT_RETENTION_POLICY, activityMs: 1, ledgerMs: 1, deliveredEventMs: 1, invocationMs: 1,
        capacityMinAgeMs: 1, maxActivityRows: 1, maxInvocationRows: 1, maxOutboxRows: 1 } });

    expect(f.r.getOutboxEvent(f.event.id)).not.toBeNull();
    expect(f.r.listRunInvocations(f.runId).length).toBeGreaterThan(0);
    drainAutomaticRecoveries({ repositories: f.r, mode: "brief-only-v1", now: () => dueAt });
    expect(f.r.executionRecovery.get("task_1")).toMatchObject({ state: "queued" });
  });

  it("once history is swept, redelivering the old event decides nothing new and the budget is unchanged", async () => {
    const f = await failedRun();
    const lines: string[] = [];
    const supervisor = new Supervisor({ repositories: f.r, supervisorId: "supervisor", recoveryMode: "report_only",
      retention: DEFAULT_RETENTION_POLICY, now: () => new Date(Date.now() + 90 * DAY), log: (line) => lines.push(line) });
    const budgetBefore = f.r.executionBudget.getTask("task_1");
    const decisionsBefore = f.r.listRecoveryDecisions("company_1");

    // The first pass delivers the event and, 90 days on, sweeps what that delivery made eligible.
    const first = await supervisor.scanOnce();
    expect(first.deliveredEventIds).toContain(f.event.id);
    expect(first.retention).toMatchObject({ deletedEvents: 0 });
    const second = await new Supervisor({ repositories: f.r, supervisorId: "supervisor", recoveryMode: "report_only",
      retention: DEFAULT_RETENTION_POLICY, now: () => new Date(Date.now() + 200 * DAY) }).scanOnce();

    expect(second.retention?.error).toBeUndefined();
    expect(second.retention!.deletedEvents).toBeGreaterThan(0);
    expect(f.r.getOutboxEvent(f.event.id)).toBeNull();
    // The failed run is still the latest run of a Task parked on a Hold: its detail stays.
    expect(f.r.listOpenTaskHolds("task_1")).toHaveLength(1);
    expect(f.r.listRunInvocations(f.runId).length).toBeGreaterThan(0);
    expect(f.r.executionBudget.getTask("task_1")).toEqual(budgetBefore);

    const replay = new RecoveryCoordinator({ repositories: f.r, mode: "report_only" }).consume(f.event);
    expect(replay.alreadyDecided).toBe(true);
    expect(f.r.listRecoveryDecisions("company_1")).toHaveLength(decisionsBefore.length + first.decisions.length);
    expect(f.r.executionRecovery.get("task_1")).toBeUndefined();
  });
});
