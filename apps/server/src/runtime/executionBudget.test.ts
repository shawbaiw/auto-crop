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
import { reconcileStaleRunningTasks } from "./taskRecovery";
import { reconcileExitedWorker } from "./workerExit";
import { settleAgentRun } from "./executionSettlement";
import { resolveBudgetSnapshot } from "./budgetPolicy";
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

