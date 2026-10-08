import { Supervisor } from "./supervisor";
import { ExecutionHealthMonitor } from "./executionHealth";
import { RecoveryCoordinator } from "./recoveryCoordinator";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Task, Proof } from "@auto-crop/core";
import type { AgentAdapter, AgentRunResult } from "../adapters/types";
import { createCliAgentAdapter } from "../adapters/cliAgent";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { openState } from "./fixtures/budgetState";
import { runSchedulerOnce, type RunSchedulerOnceInput } from "./scheduler";
import { recoverTask, reconcileStaleRunningTasks } from "./taskRecovery";
import { reconcileExitedWorker } from "./workerExit";
import { settleAgentRun } from "./executionSettlement";
import { resolveBudgetSnapshot } from "./budgetPolicy";
import { requestBudgetStop } from "./budgetStop";
import { authorizeExecutionBudget, assertOrdinaryRecoveryAllowed } from "./budgetAuthorization";
import { applyTaskTransition } from "./taskTransition";
import { createApiServer } from "../api/routes";
import { resolveEffectiveTimeout } from "./executionProfile";

const cleanup: Array<() => void> = [];
afterEach(() => { vi.unstubAllEnvs(); for (const close of cleanup.splice(0).reverse()) close(); });
const complete: AgentRunResult = { status: "complete", stdout: "done", stderr: "", exitCode: 0 };
const brief = { ...complete, stdout: JSON.stringify({ purpose: "Check", approach: "Run", expectedOutcome: "Proof" }) };
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "auto-crop-budget-")));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".auto-crop"));
  const state = openState(root);
  cleanup.push(() => { try { state.client.close(); } catch { /* A restart test already closed it. */ } });
  mkdirSync(state.repositories.getTask("task_1")!.workspacePath!, { recursive: true });
  vi.stubEnv("AUTO_CROP_FORCE_AGENT_TIMEOUT_MS", "60");
  const input = (adapter: AgentAdapter): RunSchedulerOnceInput => ({
    projectRoot: root, repositories: state.repositories, adapters: [adapter], workerId: "owner", maxTasks: 1,
    approvalRequired: () => false, emit: () => undefined, heartbeatIntervalMs: 20,
    executionBudget: { runHardMs: 5000, taskTotalMs: 7000, briefMs: 1000, repairMs: 1000, finalizeMs: 1000, checkpointMs: 60, persistMs: 20 },
    proofCollector: ({ task }) => { writeValidBusinessArtifact(task); return [createProofForTask(task)]; },
  });
  return { ...state, root, input };
}
function adapter(run: AgentAdapter["run"]): AgentAdapter {
  return { id: "codex", name: "fixture", capabilities: ["code"], detect: async () => true, run };
}

it.each(["silent", "repetitive"])("keeps one real %s invocation across the old budget, pins configuration and ignores legacy reapers", async mode => {
  const f = fixture();
  const script = join(f.root, "agent.cjs");
  writeFileSync(script, `const timer = setInterval(() => { ${mode === "repetitive" ? "process.stdout.write('same\\n');" : ""} }, 10); setTimeout(() => { clearInterval(timer); process.exit(0); }, 250);`);
  const cli = createCliAgentAdapter({ id: "codex", name: "local", capabilities: ["code"], commandTemplate: `"${process.execPath}" "${script}"` });
  let runId = "";
  let epoch = 0;
  const result = await runSchedulerOnce(f.input(adapter(async request => {
    if (request.metadata.phase === "execution_brief") return brief;
    const [run] = f.repositories.listRunningAgentRuns("company_1");
    runId = run.id; epoch = run.ownerEpoch!;
    vi.stubEnv("AUTO_CROP_FORCE_AGENT_TIMEOUT_MS", "1");
    const other = createDatabaseClient(join(f.root, ".auto-crop", "state.sqlite"));
    try {
      expect(reconcileStaleRunningTasks({ repositories: createRepositories(other), companyId: "company_1", now: () => new Date("2099-01-01") }).reconciledTaskIds).toEqual([]);
    } finally { other.close(); }
    return cli.run(request);
  })));
  expect(result.failed).toEqual([]);
  expect(result.completed).toEqual(["task_1"]);
  expect(f.client.prepare("SELECT id, owner_epoch, status, policy_version FROM agent_runs").all()).toEqual([
    expect.objectContaining({ id: runId, owner_epoch: epoch, status: "complete", policy_version: "budget-v1" }),
  ]);
  expect(f.repositories.listRunInvocations(runId).filter(i => i.phase === "executing")).toHaveLength(1);
  expect(f.repositories.executionBudget.snapshot(runId)).toMatchObject({ softMs: 60, runHardMs: 5000, environment: { forceAgentTimeoutMs: "60" } });
  const budget = f.repositories.executionBudget.getRun(runId)!;
  expect(budget).toMatchObject({ settled: 1, estimated: 0, reserved_ms: 5000 });
  expect(budget.consumed_ms).toBeGreaterThanOrEqual(250);
  expect(budget.consumed_ms).toBeLessThan(5000);
  expect(f.repositories.executionBudget.getTask("task_1")).toEqual({ authorizedMs: 7000, consumedMs: budget.consumed_ms, reservedMs: 0 });
  expect(f.repositories.executionBudget.ledger(runId).filter(r => r.kind === "budget_review").length).toBeGreaterThan(0);
  const events = f.repositories.listOutboxEvents({ companyId: "company_1" });
  expect(events.filter(e => e.type === "execution_failed")).toEqual([]);
  expect(events.filter(e => e.type === "execution_budget_review").length).toBeGreaterThan(0);
  expect(new Set(events.map(e => e.id)).size).toBe(events.length);
});

it("rolls a failed settlement back with its ledger, then conservatively settles once after reopening", async () => {
  const f = fixture();
  f.client.exec("CREATE TRIGGER fail_settlement BEFORE INSERT ON outbox_events WHEN NEW.type = 'execution_completed' BEGIN SELECT RAISE(ABORT, 'settlement fault'); END");
  await expect(runSchedulerOnce(f.input(adapter(async r => r.metadata.phase === "execution_brief" ? brief : complete)))).rejects.toThrow("settlement fault");
  const run = f.repositories.listRunningAgentRuns("company_1")[0];
  expect(f.repositories.executionBudget.getRun(run.id)).toMatchObject({ settled: 0 });
  expect(f.repositories.executionBudget.ledger(run.id).filter(r => r.kind === "settled")).toEqual([]);
  f.client.close();
  const reopened = createDatabaseClient(join(f.root, ".auto-crop", "state.sqlite"));
  cleanup.push(() => reopened.close());
  const repos = createRepositories(reopened);
  reopened.exec("DROP TRIGGER fail_settlement");
  reconcileExitedWorker({ repositories: repos, ownerId: "owner" });
  reconcileExitedWorker({ repositories: repos, ownerId: "owner" });
  expect(repos.executionBudget.getRun(run.id)).toMatchObject({ settled: 1, estimated: 1, consumed_ms: 5000 });
  expect(repos.executionBudget.getTask("task_1")).toEqual({ authorizedMs: 7000, consumedMs: 5000, reservedMs: 0 });
  expect(repos.executionBudget.ledger(run.id).filter(r => r.kind === "settled")).toHaveLength(1);
});

it("rolls run, epoch, workspace and reservation back together when reserving fails", async () => {
  const f = fixture();
  f.client.exec("CREATE TRIGGER fail_reserve BEFORE INSERT ON budget_ledger BEGIN SELECT RAISE(ABORT, 'reservation fault'); END");
  let calls = 0;
  await expect(runSchedulerOnce(f.input(adapter(async () => { calls++; return complete; })))).rejects.toThrow("reservation fault");
  expect(calls).toBe(0);
  expect(f.repositories.getTask("task_1")?.status).toBe("queued");
  expect(f.repositories.listWorkspaceClaims()).toEqual([]);
  expect(f.repositories.listTaskLocks()).toEqual([]);
  expect(f.client.prepare("SELECT * FROM agent_runs").all()).toEqual([]);
  expect(f.repositories.executionBudget.getTask("task_1")).toBeUndefined();
});

it.each(["forward", "backward", "suspend"])("treats %s clock discontinuity as uncertainty and gates dispatch", async kind => {
  const f = fixture();
  let mono = 0, wall = Date.now();
  const config = f.input(adapter(async r => {
    if (r.metadata.phase === "execution_brief") return brief;
    mono += kind === "suspend" ? 20_000 : 10;
    wall += kind === "backward" ? -20_000 : 20_000;
    return complete;
  }));
  config.executionClock = { monotonicMs: () => mono, utcNow: () => new Date(wall) };
  await runSchedulerOnce(config);
  expect(f.repositories.getTask("task_1")?.latestFailureReason).toBe("clock_untrusted");
  expect(f.repositories.executionBudget.ownerBlocked("owner")).toBe(true);
  expect(f.repositories.executionBudget.getTask("task_1")).toMatchObject({ consumedMs: 5000, reservedMs: 0 });
  f.repositories.writeTaskStatusUnchecked("task_1", "queued");
  expect((await runSchedulerOnce(config)).started).toEqual([]);
});

it("does not let config changes or observe mode reset existing Task authorization", async () => {
  const f = fixture();
  await runSchedulerOnce(f.input(adapter(async r => r.metadata.phase === "execution_brief" ? brief : complete)));
  const original = f.repositories.executionBudget.getTask("task_1")!;
  f.repositories.writeTaskStatusUnchecked("task_1", "queued");
  const config = f.input(adapter(async r => r.metadata.phase === "execution_brief" ? brief : complete));
  config.executionBudget = undefined;
  expect((await runSchedulerOnce(config)).started).toEqual([]);
  config.executionBudget = { ...f.input(adapter(async () => complete)).executionBudget, taskTotalMs: 1_000_000 };
  await runSchedulerOnce(config);
  expect(f.repositories.executionBudget.getTask("task_1")!.authorizedMs).toBe(original.authorizedMs);
  const latest = f.client.prepare("SELECT id FROM agent_runs ORDER BY rowid DESC LIMIT 1").get() as { id: string };
  expect(f.repositories.executionBudget.snapshot(latest.id)?.taskTotalMs).toBe(original.authorizedMs);
});

it("validates new-mode configuration without weakening legacy environment parsing", () => {
  const timeout = resolveEffectiveTimeout({ proofSchemaId: "repo-diff", requiredCapabilities: ["code"] }, {});
  expect(() => resolveBudgetSnapshot({ runHardMs: 1 }, timeout, {})).toThrow("soft checkpoint");
  expect(() => resolveBudgetSnapshot({ taskTotalMs: NaN }, timeout, {})).toThrow("taskTotalMs");
  expect(() => resolveBudgetSnapshot({}, timeout, { AUTO_CROP_FORCE_AGENT_TIMEOUT_MS: "bad" })).toThrow("AUTO_CROP_FORCE");
});

it("accounts brief, execution, syntax repair and finalization on one monotonic timeline", async () => {
  const f = fixture();
  let mono = 0;
  const base = Date.now();
  let calls = 0;
  const config = f.input(adapter(async request => {
    calls++;
    if (request.metadata.phase === "execution_brief") { mono += 10; return brief; }
    const artifact = join(request.workspacePath, ".auto-crop", "business-artifact.json");
    mkdirSync(join(request.workspacePath, ".auto-crop"), { recursive: true });
    if (calls === 2) { mono += 70; writeFileSync(artifact, '{"text":"OK",}'); }
    else { mono += 20; writeFileSync(artifact, '{"text":"OK"}'); }
    return complete;
  }));
  config.executionClock = { monotonicMs: () => mono, utcNow: () => new Date(base + mono) };
  const collect = config.proofCollector;
  config.proofCollector = request => { mono += 15; return collect(request); };
  expect((await runSchedulerOnce(config)).completed).toEqual(["task_1"]);
  const run = f.client.prepare("SELECT id FROM agent_runs").get() as { id: string };
  expect(f.repositories.executionBudget.getRun(run.id)).toMatchObject({ consumed_ms: 115, estimated: 0, settled: 1 });
  expect(f.repositories.listRunInvocations(run.id).map(i => i.phase)).toEqual(["preparing_brief", "executing", "repairing_artifact", "finalizing"]);
  expect(calls).toBe(3);
});

it("rejects a success that crosses its finalization cap before the transaction commits", async () => {
  const f = fixture();
  let mono = 0;
  const base = Date.now();
  const config = f.input(adapter(async r => r.metadata.phase === "execution_brief" ? brief : complete));
  config.executionClock = { monotonicMs: () => mono, utcNow: () => new Date(base + mono) };
  const collect = config.proofCollector;
  config.proofCollector = request => { mono += 1100; return collect(request); };
  const outcome = await runSchedulerOnce(config);
  expect(outcome.completed).toEqual([]);
  expect(f.repositories.getTask("task_1")?.latestFailureReason).toBe("phase_budget_exhausted");
  expect(f.client.prepare("SELECT * FROM proofs").all()).toEqual([]);
  expect(f.repositories.listOutboxEvents({ companyId: "company_1" }).some(e => e.type === "execution_completed")).toBe(false);
  expect(f.repositories.executionBudget.getTask("task_1")).toMatchObject({ consumedMs: 1100, reservedMs: 0 });
});

it("does not duplicate reservations across connections or refund a settlement twice", async () => {
  const f = fixture();
  const other = createDatabaseClient(join(f.root, ".auto-crop", "state.sqlite"));
  cleanup.push(() => other.close());
  const repos = createRepositories(other);
  await runSchedulerOnce(f.input(adapter(async request => {
    if (request.metadata.phase === "execution_brief") return brief;
    const [first] = f.repositories.listRunningAgentRuns("company_1");
    const snapshot = f.repositories.executionBudget.snapshot(first.id)!;
    repos.transaction(() => {
      repos.createAgentRun({ ...first, id: "parallel-reservation" });
      expect(repos.executionBudget.reserve("parallel-reservation", first.taskId, first.ownerEpoch!, snapshot, new Date().toISOString())).toBe(2000);
    });
    expect(f.repositories.executionBudget.getTask("task_1")).toMatchObject({ reservedMs: 7000 });
    expect(() => f.repositories.transaction(() => {
      f.repositories.createAgentRun({ ...first, id: "overdrawn" });
      f.repositories.executionBudget.reserve("overdrawn", first.taskId, first.ownerEpoch!, snapshot, new Date().toISOString());
    })).toThrow("no unreserved balance");
    return complete;
  })));
  const row = f.client.prepare("SELECT id FROM agent_runs WHERE id <> 'parallel-reservation'").get() as { id: string };
  const before = repos.executionBudget.getTask("task_1");
  expect(settleAgentRun({ repositories: repos, runId: row.id, at: new Date().toISOString(), outcome: { status: "complete", budgetUsedMs: 0 }, createId: () => "duplicate", commit: () => { throw new Error("lost claimant must not commit"); } })).toBe(false);
  expect(repos.executionBudget.getTask("task_1")).toEqual(before);
  expect(repos.executionBudget.ledger(row.id).filter(r => r.kind === "settled")).toHaveLength(1);
});

it("migrates legacy rows without inventing a budget and preserves new reservations on a second migration", async () => {
  const f = fixture();
  f.repositories.createAgentRun({ id: "legacy", taskId: "task_1", agentId: "codex", status: "failed", logPath: "legacy.log", startedAt: null, finishedAt: null });
  migrate(f.client);
  expect(f.repositories.executionBudget.snapshot("legacy")).toBeNull();
  expect(f.repositories.executionBudget.getTask("task_1")).toBeUndefined();
  await runSchedulerOnce(f.input(adapter(async r => r.metadata.phase === "execution_brief" ? brief : complete)));
  const before = f.repositories.executionBudget.getTask("task_1");
  migrate(f.client);
  expect(f.repositories.executionBudget.getTask("task_1")).toEqual(before);
});

function createProofForTask(task: Task): Proof {
  return {
    id: `proof_${task.id}_${crypto.randomUUID()}`,
    taskId: task.id,
    type: "command_output",
    uri: "agent.log",
    summary: "mock proof",
    verifiedAt: null,
  };
}

function writeValidBusinessArtifact(task: Task): void {
  if (!task.workspacePath) {
    throw new Error(`Task ${task.id} has no workspace path`);
  }

  mkdirSync(join(task.workspacePath, ".auto-crop"), { recursive: true });
  writeFileSync(
    join(task.workspacePath, ".auto-crop", "business-artifact.json"),
    JSON.stringify({
      artifact_kind: "deliverable",
      artifact_role: "implementation",
      artifact_subtype: "prototype_implementation",
      task_type: "engineering.prototype_implementation",
      payload: {
        summary: "Mock implementation completed.",
        execution_report: {
                    work_summary: "Compared the requested inputs and checked the deliverable.",
                    evidence: "Recorded checks support the reported result.",
          conclusion: "The prototype implementation is complete and passes its mock proof.",
          vision_impact: "It advances the objective's build milestone.",
          remaining_gap: "Validation with real users before launch remains.",
          recommendation: "Review the completed mock proof.",
        },
        outcome_summary:
          "The prototype implementation is complete and passes its mock proof. It advances the objective's build milestone; the remaining gap is validation with real users before launch.",
        recommendation: "Review the completed mock proof.",
        evidence: ["mock proof"],
        risks: [],
        next_steps: ["CEO review"],
      },
      lineage: { task_id: task.id },
    }),
    "utf8",
  );
}



it.each(["preparing_brief", "executing", "repairing_artifact", "finalizing"] as const)("attributes a hard stop to %s and rejects late success", async phase => {
  const f = fixture();
  let mono = 0, calls = 0;
  const config = f.input(adapter(async request => {
    calls++;
    if (request.metadata.phase === "execution_brief") { if (phase === "preparing_brief") mono += 1100; return brief; }
    if (phase === "executing") mono += 5100;
    if (phase === "repairing_artifact") {
      mkdirSync(join(request.workspacePath, ".auto-crop"), { recursive: true });
      writeFileSync(join(request.workspacePath, ".auto-crop/business-artifact.json"), '{"text":"OK",}');
      if (calls === 3) mono += 1100;
    }
    return complete;
  }));
  config.executionClock = { monotonicMs: () => mono, utcNow: () => new Date(1700000000000 + mono) };
  config.executionBudget = { ...config.executionBudget, clockToleranceMs: 10000 };
  const collect = config.proofCollector;
  config.proofCollector = req => { if (phase === "finalizing") mono += 1100; return collect(req); };
  const result = await runSchedulerOnce(config);
  expect(result.completed).toEqual([]);
  const run = f.client.prepare("SELECT id FROM agent_runs").get() as { id: string };
  expect(f.repositories.executionBudget.stopRequest(run.id)).toMatchObject({ phase,
    reason: phase === "executing" ? "run_budget_exhausted" : "phase_budget_exhausted" });
  expect(f.repositories.listOpenTaskHolds("task_1").map(h => h.kind)).toContain("execution_budget_exhausted");
  expect(f.repositories.listOutboxEvents({ companyId: "company_1" }).filter(e => e.type === "execution_budget_exhausted")).toHaveLength(1);
  expect(f.repositories.countAgentRunsForTask("task_1")).toBe(0);
  if (phase === "preparing_brief") expect(calls).toBe(1);
});

it("kills a real output flood after the durable stop claim and accounts for termination grace separately", async () => {
  const f = fixture();
  const script = join(f.root, "flood.cjs");
  writeFileSync(script, "process.on('SIGTERM', () => {}); setInterval(() => process.stdout.write('same\\n'), 5);");
  const cli = createCliAgentAdapter({ id: "codex", name: "flood", capabilities: ["code"], commandTemplate: `"${process.execPath}" "${script}"` });
  let sawStopBeforeSignal = false;
  const config = f.input(adapter(async request => {
    if (request.metadata.phase === "execution_brief") return brief;
    const run = f.repositories.listRunningAgentRuns("company_1")[0];
    request.signal!.addEventListener("abort", () => {
      sawStopBeforeSignal = Boolean(f.repositories.executionBudget.stopRequest(run.id));
    }, { once: true });
    return cli.run({ ...request, graceMs: 60, confirmMs: 300 });
  }));
  config.executionBudget = { ...config.executionBudget, runHardMs: 300 };
  const result = await runSchedulerOnce(config);
  expect(result.completed).toEqual([]);
  expect(sawStopBeforeSignal).toBe(true);
  const run = f.client.prepare("SELECT id FROM agent_runs").get() as { id: string };
  const stop = f.repositories.executionBudget.stopRequest(run.id)!;
  expect(stop).toMatchObject({ reason: "run_budget_exhausted", termination_confirmed: 1 });
  expect(stop.termination_wait_ms).toBeGreaterThanOrEqual(40);
  expect(f.repositories.executionBudget.getRun(run.id)).toMatchObject({ consumed_ms: 300, estimated: 0, settled: 1 });
  expect(f.repositories.listWorkspaceClaims()).toEqual([]);
  const events = f.repositories.listOutboxEvents({ companyId: "company_1" });
  expect(events.filter(e => e.type === "execution_stop_requested")).toHaveLength(1);
  expect(events.filter(e => e.type === "execution_budget_exhausted")).toEqual([expect.objectContaining({ payload: expect.objectContaining({ terminationConfirmed: true }) })]);
});

it("lets only one of stop and success win across connections and rolls a stop event fault back", async () => {
  const f = fixture();
  const other = createDatabaseClient(join(f.root, ".auto-crop/state.sqlite"));
  cleanup.push(() => other.close());
  const r = createRepositories(other);
  await runSchedulerOnce(f.input(adapter(async request => {
    if (request.metadata.phase === "execution_brief") return brief;
    const run = r.listRunningAgentRuns("company_1")[0];
    const stop = () => requestBudgetStop({ repositories: r, runId: run.id, reason: "run_budget_exhausted", phase: "executing", at: new Date().toISOString(), usedMs: 100 });
    other.exec("CREATE TRIGGER fail_stop BEFORE INSERT ON outbox_events WHEN NEW.type = 'execution_stop_requested' BEGIN SELECT RAISE(ABORT, 'stop fault'); END");
    expect(stop).toThrow("stop fault");
    expect(r.executionBudget.stopRequest(run.id)).toBeUndefined();
    other.exec("DROP TRIGGER fail_stop");
    expect(stop()).toBe(true);
    expect(stop()).toBe(false);
    expect(settleAgentRun({ repositories: f.repositories, runId: run.id, outcome: { status: "complete" },
      at: new Date().toISOString(), createId: () => "must-not-publish", commit: () => { throw new Error("late success committed"); } })).toBe(false);
    return complete;
  })));
  expect(f.repositories.getTask("task_1")?.latestFailureReason).toBe("run_budget_exhausted");
  expect(r.listOutboxEvents({ companyId: "company_1" }).filter(e => e.type === "execution_completed")).toEqual([]);
  const success = fixture();
  await runSchedulerOnce(success.input(adapter(async req => req.metadata.phase === "execution_brief" ? brief : complete)));
  const row = success.client.prepare("SELECT id FROM agent_runs").get() as { id: string };
  expect(requestBudgetStop({ repositories: success.repositories, runId: row.id, reason: "run_budget_exhausted", phase: "executing", at: new Date().toISOString(), usedMs: 5000 })).toBe(false);
  expect(success.repositories.executionBudget.stopRequest(row.id)).toBeUndefined();
});

async function exhaustedFixture(unconfirmed = false) {
  const f = fixture();
  let mono = 0;
  const config = f.input(adapter(async req => {
    if (req.metadata.phase === "execution_brief") return brief;
    mono += 300;
    return { ...complete, terminationConfirmed: unconfirmed ? false : undefined };
  }));
  config.executionClock = { monotonicMs: () => mono, utcNow: () => new Date(1700000000000 + mono) };
  config.executionBudget = { ...config.executionBudget, taskTotalMs: 200 };
  await runSchedulerOnce(config);
  return f;
}

it("preserves exhausted authorization through reset/reopen and does not spawn before a new grant", async () => {
  const f = await exhaustedFixture();
  expect(f.repositories.getTask("task_1")?.latestFailureReason).toBe("task_budget_exhausted");
  const run = f.client.prepare("SELECT id FROM agent_runs").get() as { id: string };
  f.repositories.markTaskAttemptsReset("task_1", new Date().toISOString());
  applyTaskTransition({ repositories: f.repositories, task: "task_1", status: "queued", resolvesHoldKinds: ["execution_budget_exhausted"] });
  f.client.close();
  const reopened = createDatabaseClient(join(f.root, ".auto-crop/state.sqlite"));
  cleanup.push(() => reopened.close());
  const r = createRepositories(reopened);
  const config = { ...f.input(adapter(async () => { throw new Error("exhausted task spawned"); })), repositories: r, workerId: "new-owner" };
  expect((await runSchedulerOnce(config)).blocked).toEqual(["task_1"]);
  expect((await runSchedulerOnce(config)).completed).toEqual([]);
  expect(r.executionBudget.getTask("task_1")).toEqual({ authorizedMs: 200, consumedMs: 200, reservedMs: 0 });
  expect(r.executionBudget.snapshot(run.id)?.taskTotalMs).toBe(200);
  expect(() => assertOrdinaryRecoveryAllowed(r, "task_1")).toThrow("explicit founder");
});

it("charges quota time without consuming a failure attempt", async () => {
  const f = fixture();
  let mono = 0;
  const config = f.input(adapter(async req => {
    mono += 20;
    return req.metadata.phase === "execution_brief" ? brief : { ...complete, status: "failed", failureReason: "agent_quota_exhausted" };
  }));
  config.executionClock = { monotonicMs: () => mono, utcNow: () => new Date(1700000000000 + mono) };
  await runSchedulerOnce(config);
  expect(f.repositories.countAgentRunsForTask("task_1")).toBe(0);
  expect(f.repositories.executionBudget.getTask("task_1")).toMatchObject({ consumedMs: 40, reservedMs: 0 });
  f.repositories.markTaskAttemptsReset("task_1", new Date().toISOString());
  expect(f.repositories.executionBudget.getTask("task_1")?.consumedMs).toBe(40);
});

it("authorizes once, preserves the old snapshot and rejects stale concurrent grants and cancelled tasks", async () => {
  const f = await exhaustedFixture();
  const input = { repositories: f.repositories, taskId: "task_1", id: "grant-1", additionalMs: 500, expectedAuthorizedMs: 200, reason: "finish the task" };
  expect(() => authorizeExecutionBudget({ ...input, additionalMs: 0 })).toThrow("No remaining");
  f.client.exec("CREATE TRIGGER fail_authorize BEFORE INSERT ON task_events WHEN NEW.id = 'budget-authorization:grant-1' BEGIN SELECT RAISE(ABORT, 'audit fault'); END");
  expect(() => authorizeExecutionBudget(input)).toThrow("audit fault");
  expect(f.repositories.executionBudget.getTask("task_1")?.authorizedMs).toBe(200);
  expect(f.repositories.executionBudget.authorization("grant-1")).toBeUndefined();
  expect(f.repositories.listOpenTaskHolds("task_1").map(h => h.kind)).toContain("execution_budget_exhausted");
  f.client.exec("DROP TRIGGER fail_authorize");
  const other = createDatabaseClient(join(f.root, ".auto-crop/state.sqlite"));
  cleanup.push(() => other.close());
  const r = createRepositories(other);
  expect(authorizeExecutionBudget(input)).toMatchObject({ replayed: false, task: { status: "queued" } });
  expect(authorizeExecutionBudget({ ...input, repositories: r })).toMatchObject({ replayed: true });
  expect(() => authorizeExecutionBudget({ ...input, repositories: r, id: "grant-2" })).toThrow();
  expect(() => authorizeExecutionBudget({ ...input, additionalMs: 501 })).toThrow("different input");
  expect(r.executionBudget.getTask("task_1")).toMatchObject({ authorizedMs: 700, consumedMs: 200 });
  const run = f.client.prepare("SELECT id FROM agent_runs").get() as { id: string };
  expect(r.executionBudget.snapshot(run.id)?.taskTotalMs).toBe(200);
  applyTaskTransition({ repositories: r, task: "task_1", status: "cancelled" });
  expect(() => authorizeExecutionBudget({ ...input, id: "after-cancel", expectedAuthorizedMs: 700 })).toThrow("not parked");
});

it("validates the authorization HTTP route and refuses unconfirmed termination", async () => {
  const f = await exhaustedFixture(true);
  expect(f.repositories.listWorkspaceClaims()[0]?.isolatedReason).toBeTruthy();
  const server = createApiServer({ projectRoot: f.root, repositories: f.repositories, agents: [adapter(async () => complete)] });
  await new Promise<void>(resolve => server.httpServer.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.httpServer.address() as { port: number }).port;
    const post = (body: unknown, task = "task_1") => fetch(`http://127.0.0.1:${port}/api/tasks/${task}/execution-budget`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const grant = { id: "http-grant", additionalMs: 500, expectedAuthorizedMs: 200, reason: "continue" };
    expect((await post(grant, "missing")).status).toBe(404);
    expect((await post({ ...grant, additionalMs: -1 })).status).toBe(400);
    expect((await post(grant)).status).toBe(409);
    // The founder must first confirm the old writer is gone; that still grants no new budget.
    const confirm = await fetch(`http://127.0.0.1:${port}/api/tasks/task_1/confirm-termination`, { method: "POST" });
    expect(confirm.status).toBe(200);
    expect(f.repositories.listWorkspaceClaims()).toEqual([]);
    expect(f.repositories.listOpenTaskHolds("task_1").map(h => h.kind)).toContain("execution_budget_exhausted");
    expect((await post({ ...grant, expectedAuthorizedMs: 201 })).status).toBe(409);
    expect((await post(grant)).status).toBe(200);
    const replay = await post(grant);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, budget: { authorizedMs: 700 } });
  } finally { await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve())); }
});


it("handles a stop that wins exactly between the success precheck and SQL claim", async () => {
  const f = fixture();
  const other = createDatabaseClient(join(f.root, ".auto-crop/state.sqlite"));
  cleanup.push(() => other.close());
  const r = createRepositories(other);
  const original = f.repositories.updateAgentRunStatus;
  const spy = vi.spyOn(f.repositories, "updateAgentRunStatus").mockImplementation((...args) => {
    if (args[1] === "complete") requestBudgetStop({ repositories: r, runId: args[0], reason: "run_budget_exhausted",
      phase: "finalizing", at: new Date().toISOString(), usedMs: 100 });
    return original(...args);
  });
  try {
    const result = await runSchedulerOnce(f.input(adapter(async req => req.metadata.phase === "execution_brief" ? brief : complete)));
    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual(["task_1"]);
    expect(f.repositories.listRunningAgentRuns("company_1")).toEqual([]);
    expect(f.client.prepare("SELECT * FROM proofs").all()).toEqual([]);
    expect(f.repositories.listOpenTaskHolds("task_1").map(h => h.kind)).toContain("execution_budget_exhausted");
  } finally { spy.mockRestore(); }
});

it("can explicitly resume a phase stop using remaining funds without changing authorization", async () => {
  const f = fixture();
  let mono = 0;
  const config = f.input(adapter(async () => { mono += 1100; return brief; }));
  config.executionClock = { monotonicMs: () => mono, utcNow: () => new Date(1700000000000 + mono) };
  await runSchedulerOnce(config);
  const granted = authorizeExecutionBudget({ repositories: f.repositories, taskId: "task_1", id: "resume", reason: "retry brief within existing allowance", additionalMs: 0, expectedAuthorizedMs: 7000 });
  expect(granted.task.status).toBe("queued");
  expect(granted.authorization).toMatchObject({ additional_ms: 0, authorized_after_ms: 7000 });
  const result = await runSchedulerOnce(f.input(adapter(async req => req.metadata.phase === "execution_brief" ? brief : complete)));
  expect(result.completed).toEqual(["task_1"]);
  expect(f.client.prepare("SELECT * FROM agent_runs").all()).toHaveLength(2);
  expect(f.repositories.executionBudget.getTask("task_1")!.consumedMs).toBeGreaterThanOrEqual(1100);
  expect(f.repositories.executionBudget.getTask("task_1")!.authorizedMs).toBe(7000);
});

it("does not replenish the entire reservation lost to a crashed owner", async () => {
  const f = fixture();
  f.client.exec("CREATE TRIGGER fail_settlement BEFORE INSERT ON outbox_events WHEN NEW.type = 'execution_completed' BEGIN SELECT RAISE(ABORT, 'crash'); END");
  const config = f.input(adapter(async req => req.metadata.phase === "execution_brief" ? brief : complete));
  config.executionBudget = { ...config.executionBudget, runHardMs: 200, taskTotalMs: 200 };
  await expect(runSchedulerOnce(config)).rejects.toThrow("crash");
  f.client.close();
  const reopened = createDatabaseClient(join(f.root, ".auto-crop/state.sqlite"));
  cleanup.push(() => reopened.close());
  reopened.exec("DROP TRIGGER fail_settlement");
  const r = createRepositories(reopened);
  reconcileExitedWorker({ repositories: r, ownerId: "owner" });
  reconcileExitedWorker({ repositories: r, ownerId: "owner" });
  expect(r.executionBudget.getTask("task_1")).toEqual({ authorizedMs: 200, consumedMs: 200, reservedMs: 0 });
  const next = { ...f.input(adapter(async () => { throw new Error("crashed reservation reset"); })), repositories: r, workerId: "replacement" };
  expect((await runSchedulerOnce(next)).completed).toEqual([]);
  expect(() => assertOrdinaryRecoveryAllowed(r, "task_1")).toThrow("explicit founder");
  expect(reopened.prepare("SELECT * FROM agent_runs").all()).toHaveLength(1);
});


it("keeps ordinary Partial Output recovery on the authorized Task instead of minting a follow-up budget", async () => {
  const f = fixture();
  let mono = 0;
  const config = f.input(adapter(async req => {
    mono += 20;
    return req.metadata.phase === "execution_brief" ? brief : { ...complete, status: "failed", failureReason: "agent_failed" };
  }));
  config.executionClock = { monotonicMs: () => mono, utcNow: () => new Date(1700000000000 + mono) };
  await runSchedulerOnce(config);
  applyTaskTransition({ repositories: f.repositories, task: "task_1", status: "failed",
    executionSummary: { artifactWorkspacePath: f.repositories.getTask("task_1")!.workspacePath } });
  const recovered = recoverTask({ repositories: f.repositories, taskId: "task_1", proofSchemas: [] });
  expect(recovered.task.id).toBe("task_1");
  expect(recovered.task.status).toBe("queued");
  expect(recovered.followUpTask).toBeUndefined();
  expect(f.repositories.executionBudget.getTask("task_1")).toEqual({ authorizedMs: 7000, consumedMs: 40, reservedMs: 0 });
  const result = await runSchedulerOnce(f.input(adapter(async req => req.metadata.phase === "execution_brief" ? brief : complete)));
  expect(result.completed).toEqual(["task_1"]);
  expect(f.repositories.executionBudget.getTask("task_1")!.consumedMs).toBeGreaterThanOrEqual(40);
});


it("independently records suspect/recovery/lost events and delivers each once without GET", async () => {
  const f = fixture();
  let mono = 0;
  const base = Date.now();
  const stops: string[] = [], probes: string[] = [];
  const supervisor = new Supervisor({ repositories: f.repositories, supervisorId: "monitor", now: () => new Date(base + mono),
    clock: { monotonicMs: () => mono, utcNow: () => new Date(base + mono) },
    probeOwner: id => probes.push(id), stopOwner: id => stops.push(id) });
  const config = f.input(adapter(async req => {
    if (req.metadata.phase === "execution_brief") return brief;
    const run = f.repositories.listRunningAgentRuns("company_1")[0];
    f.client.prepare("UPDATE agent_runs SET last_heartbeat_at = ?, last_activity_at = NULL WHERE id = ?").run(new Date(base).toISOString(), run.id);
    await supervisor.scanOnce();
    expect(f.repositories.executionBudget.health(run.id)?.state).toBe("unknown");
    config.executionBudget = { ...config.executionBudget, lostAfterMs: 100000 }; // A later config cannot alter this run's pinned health windows.
    mono = 60; await supervisor.scanOnce();
    expect(f.repositories.executionBudget.health(run.id)?.state).toBe("suspect");
    mono = 70;
    f.client.prepare("UPDATE agent_runs SET last_heartbeat_at = ?, last_activity_at = ? WHERE id = ?").run(new Date(base + mono).toISOString(), new Date(base + mono).toISOString(), run.id);
    await supervisor.scanOnce();
    expect(f.repositories.executionBudget.health(run.id)?.state).toBe("responsive");
    mono = 180; await supervisor.scanOnce();
    expect(f.repositories.executionBudget.health(run.id)?.state).toBe("lost");
    expect(stops).toEqual(["owner"]);
    expect(probes).toContain("owner");
    expect(f.repositories.listWorkspaceClaims()).toHaveLength(1);
    return { ...complete, terminationConfirmed: true };
  }));
  config.executionBudget = { ...config.executionBudget, suspectAfterMs: 45, lostAfterMs: 100, resumeGraceMs: 10 };
  expect((await runSchedulerOnce(config)).completed).toEqual([]);
  await supervisor.scanOnce();
  const events = f.repositories.listOutboxEvents({ companyId: "company_1" });
  expect(events.filter(e => e.type === "execution_suspected")).toHaveLength(2);
  expect(events.filter(e => e.type === "execution_responsive")).toHaveLength(1);
  expect(events.every(e => e.deliveredAt)).toBe(true);
  const coordinator = new RecoveryCoordinator({ repositories: f.repositories });
  for (const event of events) expect(coordinator.consume(event).alreadyDecided).toBe(true);
  expect(f.repositories.listRecoveryDecisions("company_1")).toHaveLength(events.length);
});

it.each(["forward", "backward", "suspend"])("probes after %s instead of treating sleep or clock changes as immediate loss", async kind => {
  const f = fixture();
  let mono = 0, wall = Date.now();
  const probes: string[] = [], stops: string[] = [];
  const monitor = new ExecutionHealthMonitor({ repositories: f.repositories,
    clock: { monotonicMs: () => mono, utcNow: () => new Date(wall) }, probeOwner: id => probes.push(id), stopOwner: id => stops.push(id) });
  await runSchedulerOnce(f.input(adapter(async req => {
    if (req.metadata.phase === "execution_brief") return brief;
    const run = f.repositories.listRunningAgentRuns("company_1")[0];
    monitor.scan();
    mono += kind === "suspend" ? 100000 : 100;
    wall += kind === "backward" ? -100000 : 100000;
    monitor.scan();
    expect(f.repositories.executionBudget.health(run.id)).toMatchObject({ state: "unknown", action: "probe" });
    expect(stops).toEqual([]);
    expect(f.repositories.executionBudget.stopRequest(run.id)).toBeUndefined();
    // The owner responds during recovery grace; a new heartbeat prevents loss after the grace.
    for (const step of [10000, 10000, 10000, 100]) {
      mono += step; wall += step;
      f.client.prepare("UPDATE agent_runs SET last_heartbeat_at = ? WHERE id = ?").run(new Date(wall).toISOString(), run.id);
      monitor.scan();
    }
    expect(f.repositories.executionBudget.health(run.id)?.action).toBe("continue");
    expect(stops).toEqual([]);
    expect(probes).toContain("owner");
    return complete;
  })));
});

it.each([0, 25])("keeps %i GET polls read-only and honours cancellation before any continuation", async polls => {
  const f = fixture();
  const server = createApiServer({ projectRoot: f.root, repositories: f.repositories, agents: [] });
  await new Promise<void>(resolve => server.httpServer.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.httpServer.address() as { port: number }).port}`;
  try {
    const result = await runSchedulerOnce(f.input(adapter(async req => {
      if (req.metadata.phase === "execution_brief") return brief;
      const run = f.repositories.listRunningAgentRuns("company_1")[0];
      const before = f.repositories.executionBudget.health(run.id);
      for (let i = 0; i < polls; i++) {
        const response = await fetch(`${base}/api/tasks/task_1/execution`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ task: { execution: { runId: run.id, policyVersion: "budget-v1", budget: { authorizedMs: 7000 } } } });
      }
      expect(f.repositories.executionBudget.health(run.id)).toEqual(before);
      const cancel = await fetch(`${base}/api/tasks/task_1/cancel`, { method: "POST" });
      expect(cancel.status).toBe(200);
      expect(req.signal!.aborted).toBe(true);
      return { ...complete, terminationConfirmed: true }; // A deliberately late successful adapter reply.
    })));
    expect(result.completed).toEqual([]);
    expect(f.repositories.getTask("task_1")?.status).toBe("cancelled");
    expect(f.repositories.listOutboxEvents({ companyId: "company_1" }).some(e => e.type === "execution_completed")).toBe(false);
    expect((await fetch(`${base}/api/tasks/task_1/execution-budget`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "cancelled", additionalMs: 100, expectedAuthorizedMs: 7000, reason: "must not resume" }) })).status).toBe(409);
  } finally { await new Promise<void>(resolve => server.httpServer.close(() => resolve())); }
});


it.each(["unconfirmed", "worker_exit"])("keeps cancellation final after %s and manual containment confirmation", async mode => {
  const f = fixture();
  const server = createApiServer({ projectRoot: f.root, repositories: f.repositories, agents: [] });
  await new Promise<void>(resolve => server.httpServer.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.httpServer.address() as { port: number }).port}`;
  try {
    await runSchedulerOnce(f.input(adapter(async req => {
      if (req.metadata.phase === "execution_brief") return brief;
      expect((await fetch(`${base}/api/tasks/task_1/cancel`, { method: "POST" })).status).toBe(200);
      if (mode === "worker_exit") reconcileExitedWorker({ repositories: f.repositories, ownerId: "owner" });
      return { ...complete, terminationConfirmed: false };
    })));
    expect(f.repositories.listWorkspaceClaims()[0]?.isolatedReason).toBeTruthy();
    expect((await fetch(`${base}/api/tasks/task_1/confirm-termination`, { method: "POST" })).status).toBe(200);
    expect(f.repositories.getTask("task_1")?.status).toBe("cancelled");
    expect(f.repositories.listWorkspaceClaims()).toEqual([]);
    const response = await fetch(`${base}/api/tasks/task_1/execution`);
    expect(await response.json()).toMatchObject({ task: { status: "cancelled", execution: { stop: { reason: "cancelled", manualConfirmedAt: expect.any(String) } } } });
  } finally { await new Promise<void>(resolve => server.httpServer.close(() => resolve())); }
});

it("keeps observe runs on their sole legacy policy path", async () => {
  const f = fixture();
  const monitor = new ExecutionHealthMonitor({ repositories: f.repositories, stopOwner: () => { throw new Error("legacy adjudicated twice"); } });
  const config = f.input(adapter(async req => {
    monitor.scan();
    return req.metadata.phase === "execution_brief" ? brief : complete;
  }));
  config.executionBudget = undefined;
  await runSchedulerOnce(config);
  expect(f.client.prepare("SELECT * FROM run_health").all()).toEqual([]);
  expect(f.repositories.executionBudget.getTask("task_1")).toBeUndefined();
});
