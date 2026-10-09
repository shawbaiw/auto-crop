import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { openState } from "./fixtures/budgetState";
import { runSchedulerOnce } from "./scheduler";
import { RecoveryCoordinator } from "./recoveryCoordinator";
import { briefRecoveryEligibility, drainAutomaticRecoveries, recoveryModeFromEnvironment } from "./automaticRecovery";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { applyTaskTransition } from "./taskTransition";
import type { AgentAdapter } from "../adapters/types";
import { createCliAgentAdapter } from "../adapters/cliAgent";
import { Supervisor } from "./supervisor";
import { DEFAULT_LAUNCH_POLICY, type LaunchPlan } from "../adapters/launchPolicy";

const cleanup: Array<() => void> = [];
afterEach(() => { vi.unstubAllEnvs(); for (const close of cleanup.splice(0).reverse()) close(); });

async function fixture(realProcess = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "auto-crop-recovery-")));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".auto-crop"));
  const { client, repositories: r } = openState(root);
  mkdirSync(r.getTask("task_1")!.workspacePath!, { recursive: true });
  cleanup.push(() => client.close());
  vi.stubEnv("AUTO_CROP_FORCE_AGENT_TIMEOUT_MS", "60");
  const adapter: AgentAdapter = { id: "codex", name: "fixture", capabilities: ["code"], contractCapabilities: ["structured_execution_brief"], detect: async () => true,
    run: async () => ({ status: "failed", stdout: "", stderr: "connection closed", exitCode: 1,
      failureReason: "agent_failed", terminationConfirmed: true }) };
  const launchPlan = async (): Promise<LaunchPlan> => ({ policy: DEFAULT_LAUNCH_POLICY,
    support: { adapterId: "codex", isolationLevel: "strong", supportedFlags: [], missingFlags: [], warnings: [] } });
  adapter.launchPlan = launchPlan;
  const script = join(root, "failure.cjs");
  if (realProcess) writeFileSync(script, "process.exit(1);", "utf8");
  const input = { projectRoot: root, repositories: r, adapters: [realProcess
    ? { ...createCliAgentAdapter({ id: "codex", name: "local", capabilities: ["code"], contractCapabilities: ["structured_execution_brief"], commandTemplate: `"${process.execPath}" "${script}"` }), launchPlan } : adapter], workerId: "owner", maxTasks: 1,
    approvalRequired: () => false, emit: () => undefined, proofCollector: () => [],
    executionBudget: { runHardMs: 5000, taskTotalMs: 7000, briefMs: 1000, repairMs: 1000, finalizeMs: 1000, checkpointMs: 60, persistMs: 20 } };
  await runSchedulerOnce(input);
  const event = r.listOutboxEvents().find(e => e.type === "execution_failed")!;
  expect(event).toBeDefined();
  const coordinator = new RecoveryCoordinator({ repositories: r, mode: "brief-only-v1" });
  const drain = (repositories = r) => drainAutomaticRecoveries({ repositories, mode: "brief-only-v1",
    now: () => new Date(r.executionRecovery.get("task_1")!.dueAt) });
  return { root, client, r, input, event, coordinator, drain };
}

it("persists a delayed recovery, survives another connection, and preserves source and cumulative budget", async () => {
  const f = await fixture();
  expect(briefRecoveryEligibility(f.r, f.event).manifest).toBeDefined();
  const before = f.r.executionBudget.getTask("task_1")!;
  expect(f.coordinator.consume(f.event).decision.kind).toBe("scheduled");
  drainAutomaticRecoveries({ repositories: f.r, mode: "brief-only-v1", now: () => new Date(0) });
  expect(f.r.getTask("task_1")?.status).toBe("failed");
  const other = createDatabaseClient(join(f.root, ".auto-crop", "state.sqlite"));
  try {
    const r = createRepositories(other);
    expect(new RecoveryCoordinator({ repositories: r, mode: "brief-only-v1" }).consume(f.event)).toMatchObject({ alreadyDecided: true, decision: { kind: "scheduled" } });
    f.drain(r);
    f.drain();
  } finally { other.close(); }
  expect(f.r.getTask("task_1")?.status).toBe("queued");
  expect(f.r.executionBudget.getTask("task_1")).toEqual(before);
  expect(f.r.listTaskEventsForCompany("company_1").filter(e => e.type === "task_recovered")).toHaveLength(1);
  await runSchedulerOnce(f.input);
  const recovery = f.r.executionRecovery.get("task_1")!;
  expect(recovery.state).toBe("started");
  expect(recovery.nextRunId).not.toBe(f.event.runId);
  expect(JSON.parse(recovery.manifest).resumeFromRunId).toBe(f.event.runId);
  expect(f.r.executionBudget.getTask("task_1")!.authorizedMs).toBe(before.authorizedMs);
  expect(f.r.executionBudget.getTask("task_1")!.consumedMs).toBeGreaterThanOrEqual(before.consumedMs);
  const next = f.r.listOutboxEvents().find(e => e.type === "execution_failed" && e.runId === recovery.nextRunId)!;
  expect(f.coordinator.consume(next).decision.kind).toBe("report_only");
  expect(f.r.listTasksForCompany("company_1")).toHaveLength(1);
});

it("records existing workspace files as unverified hash candidates without accepting them as proof", async () => {
  const f = await fixture();
  const workspace = f.r.getTask("task_1")!.workspacePath!;
  mkdirSync(join(workspace, "notes"), { recursive: true });
  writeFileSync(join(workspace, "notes", "partial.txt"), "partial output\n", "utf8");
  writeFileSync(join(workspace, "too-large.bin"), Buffer.alloc(1024 * 1024 + 1));
  symlinkSync(join(workspace, "notes", "partial.txt"), join(workspace, "linked.txt"));
  expect(f.coordinator.consume(f.event).decision.kind).toBe("scheduled");
  const manifest = JSON.parse(f.r.executionRecovery.get("task_1")!.manifest) as {
    candidateFiles: Array<{ workspaceRole: string; relativePath: string; sizeBytes: number; sha256: string; status: string }>;
    verifiedSteps: unknown[];
    externalActions: unknown[];
    unverified: string;
  };
  expect(manifest.candidateFiles).toEqual([
    {
      workspaceRole: "task_workspace",
      relativePath: "notes/partial.txt",
      sizeBytes: "partial output\n".length,
      sha256: "23c6f689d66edc099ec38a86d5fe930db522f7ec0ceb8efeefb95a1e5f02947b",
      status: "unverified",
    },
  ]);
  expect(manifest.verifiedSteps).toEqual([]);
  expect(manifest.externalActions).toEqual([]);
  expect(manifest.unverified).toContain("not accepted as proof");
});

it.skipIf(process.platform === "win32")("recovers a real CLI process failure through scheduler and supervisor", async () => {
  const f = await fixture(true);
  expect(f.event.payload.terminationConfirmed).toBe(true);
  await new Supervisor({ repositories: f.r, supervisorId: "first", recoveryMode: "brief-only-v1" }).scanOnce();
  expect(f.r.executionRecovery.get("task_1")?.state).toBe("pending");
  await new Supervisor({ repositories: f.r, supervisorId: "restarted", recoveryMode: "brief-only-v1",
    now: () => new Date(f.r.executionRecovery.get("task_1")!.dueAt) }).scanOnce();
  expect(f.r.executionRecovery.get("task_1")?.state).toBe("queued");
  await runSchedulerOnce(f.input);
  expect(f.r.executionRecovery.get("task_1")?.nextRunId).toBeTruthy();
  expect(f.r.listWorkspaceClaims()).toEqual([]);
});

it.each(["cancel", "pause", "permission", "description", "budget", "claim", "epoch", "hold"])("rechecks %s after backoff and does not launch work", async change => {
  const f = await fixture();
  expect(f.coordinator.consume(f.event).decision.kind).toBe("scheduled");
  if (change === "cancel") applyTaskTransition({ repositories: f.r, task: f.r.getTask("task_1")!, status: "cancelled", resolution: "cancelled" });
  if (change === "pause") f.client.prepare("UPDATE companies SET status = 'paused'").run();
  if (change === "permission") f.client.prepare("UPDATE companies SET permission_mode = 'safe'").run();
  if (change === "description") f.client.prepare("UPDATE tasks SET description = 'new task'").run();
  if (change === "budget") f.client.prepare("UPDATE task_budgets SET authorized_ms = MAX(1, (SELECT SUM(consumed_ms) FROM run_budgets))").run();
  if (change === "epoch") f.r.nextExecutionEpoch("task_1");
  if (change === "hold") applyTaskTransition({ repositories: f.r, task: f.r.getTask("task_1")!, status: "blocked",
    hold: { kind: "termination_unconfirmed", reason: "Still writing" } });
  if (change === "claim") f.r.acquireTaskLock("task_1", "other", new Date().toISOString());
  f.drain();
  expect(f.r.executionRecovery.get("task_1")?.state).toBe("blocked");
  expect(f.r.getTask("task_1")?.status).not.toBe("queued");
  expect(f.r.listOutboxEvents().filter(e => e.type === "recovery_blocked")).toHaveLength(1);
});

it.each(["unknown termination", "work invocation", "budget stop", "quota", "stale run", "missing isolation", "compatible isolation"])("excludes %s from automatic recovery", async problem => {
  const f = await fixture();
  if (problem === "unknown termination") f.event.payload.terminationConfirmed = null;
  if (problem === "work invocation") f.client.prepare("UPDATE run_invocations SET phase = 'executing' WHERE phase = 'preparing_brief'").run();
  if (problem === "budget stop") f.event.payload.reason = "phase_budget_exhausted";
  if (problem === "quota") f.event.payload.reason = "agent_quota_exhausted";
  if (problem === "stale run") f.r.nextExecutionEpoch("task_1");
  if (problem === "missing isolation") f.client.prepare("UPDATE agent_runs SET launch_isolation = NULL").run();
  if (problem === "compatible isolation") f.client.prepare("UPDATE agent_runs SET launch_isolation = 'compatible'").run();
  expect(f.coordinator.consume(f.event).decision.kind).not.toBe("scheduled");
  expect(f.r.executionRecovery.get("task_1")).toBeUndefined();
});

it("keeps report-only default and never reinterprets its recorded decision after opt-in", async () => {
  const f = await fixture();
  expect(new RecoveryCoordinator({ repositories: f.r }).consume(f.event).decision.kind).toBe("report_only");
  expect(f.coordinator.consume(f.event)).toMatchObject({ alreadyDecided: true, decision: { kind: "report_only" } });
  expect(f.r.executionRecovery.get("task_1")).toBeUndefined();
  expect(recoveryModeFromEnvironment({})).toBe("report_only");
  expect(() => recoveryModeFromEnvironment({ AUTO_CROP_RECOVERY_MODE: "brief-only-v1" })).toThrow("requires budget-v1");
  expect(() => recoveryModeFromEnvironment({ AUTO_CROP_RECOVERY_MODE: "typo" })).toThrow("must be");
});

it("rolls back the queue on decision failure and rolls back activation when its event fails", async () => {
  const f = await fixture();
  f.client.exec("CREATE TRIGGER fail_decision BEFORE INSERT ON recovery_decisions BEGIN SELECT RAISE(ABORT, 'decision fault'); END");
  expect(() => f.coordinator.consume(f.event)).toThrow("decision fault");
  expect(f.r.executionRecovery.get("task_1")).toBeUndefined();
  f.client.exec("DROP TRIGGER fail_decision");
  f.coordinator.consume(f.event);
  f.client.exec("CREATE TRIGGER fail_activation BEFORE INSERT ON outbox_events WHEN NEW.type = 'recovery_scheduled' BEGIN SELECT RAISE(ABORT, 'activation fault'); END");
  expect(() => f.drain()).toThrow("activation fault");
  expect(f.r.executionRecovery.get("task_1")?.state).toBe("pending");
  expect(f.r.getTask("task_1")?.status).toBe("failed");
  f.client.exec("DROP TRIGGER fail_activation");
  f.drain();
  expect(f.r.getTask("task_1")?.status).toBe("queued");
});
