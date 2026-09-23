import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { openState } from "./fixtures/state";

// Full production entry/IPC/adapter/SQLite/dispatcher chain, with only the model executable mocked.
// Faults are injected into the disposable database; no production testing switches are needed.
it.skipIf(process.platform === "win32")("start survives reconciliation and delivery crashes without re-entering an unconfirmed workspace", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "auto-crop-execution-health-")));
  const bin = join(root, "bin");
  mkdirSync(bin);
  mkdirSync(join(root, ".auto-crop"));
  writeFileSync(join(bin, "codex"), `#!${process.execPath}\n${readFileSync(new URL("./fixtures/mockCodex.cjs", import.meta.url), "utf8")}`, { mode: 0o755 });
  writeFileSync(join(bin, "claude"), `#!${process.execPath}\nprocess.exit(1);\n`, { mode: 0o755 });
  const { client, repositories } = openState(root);
  mkdirSync(repositories.getTask("task_1")!.workspacePath!, { recursive: true });
  const children: Array<{ child: ChildProcess; output: () => string }> = [];
  const launch = () => {
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../index.ts", import.meta.url)), "start"], {
      cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, INIT_CWD: root, AUTO_CROP_SMOKE_ROOT: root, AUTO_CROP_PORT: "0", AUTO_CROP_SCHEDULER_INTERVAL_MS: "50" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const result = { child, output: () => output };
    children.push(result);
    return result;
  };
  const until = async (check: () => boolean) => {
    const deadline = Date.now() + 15_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`Smoke timed out:\n${children.map((child) => child.output()).join("\n")}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  let writerPid: number | undefined;
  try {
    const first = launch();
    await until(() => existsSync(join(root, "writer.json")));
    const writer = JSON.parse(readFileSync(join(root, "writer.json"), "utf8")) as { pid: number; workspace: string; writer: string };
    writerPid = writer.pid;
    const run = repositories.listRunningAgentRuns("company_1")[0];
    expect(run, first.output()).toBeDefined();
    expect(Date.parse(repositories.listTaskLocks()[0].leaseExpiresAt!)).toBeGreaterThan(Date.now());
    const workerPid = Number(first.output().match(/worker started \(pid (\d+)/)![1]);

    // Abort after the settlement claim. All state must roll back, and no replacement may launch.
    client.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox_events BEGIN SELECT RAISE(ABORT, 'smoke settlement fault'); END");
    process.kill(workerPid, "SIGKILL");
    await until(() => first.output().includes("restart blocked by reconciliation"));
    expect(first.output().match(/worker started/g)).toHaveLength(1);
    expect(repositories.getTask("task_1")?.status).toBe("running");
    expect(repositories.listOutboxEvents({ companyId: "company_1" })).toHaveLength(0);
    expect(repositories.listRecoveryDecisions("company_1")).toHaveLength(0);
    await stop(first.child, "SIGKILL");
    client.exec("DROP TRIGGER fail_outbox");

    // Restart from persisted owner evidence, then lose the delivery ACK after consuming the event.
    client.exec("CREATE TRIGGER fail_ack BEFORE UPDATE OF delivered_at ON outbox_events WHEN NEW.delivered_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'smoke ACK fault'); END");
    const second = launch();
    await until(() => second.child.exitCode !== null);
    expect(second.child.exitCode).toBe(1);
    expect(second.output()).toContain("smoke ACK fault");
    expect(second.output()).not.toContain("worker started");
    expect(repositories.getTask("task_1")).toMatchObject({ status: "blocked", latestFailureReason: "termination_unconfirmed" });
    expect(repositories.listOpenTaskHolds("task_1").map((hold) => hold.kind)).toEqual(["termination_unconfirmed"]);
    expect(repositories.listTaskLocks()).toHaveLength(0);
    const [event] = repositories.listOutboxEvents({ companyId: "company_1" });
    expect(event.payload).toMatchObject({ runId: run.id, reason: "worker_lost", terminationConfirmed: null });
    expect(event.deliveredAt).toBeNull();
    const [decision] = repositories.listRecoveryDecisions("company_1");
    expect(decision.sourceEventId).toBe(event.id);
    client.exec("DROP TRIGGER fail_ack");
    // Advance only this event's delivery lease, modelling the documented 30s claim expiry.
    client.prepare("UPDATE outbox_events SET claim_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(event.id);

    const third = launch();
    await until(() => third.output().includes("Dashboard:"));
    expect(third.output()).toContain("(already decided)");
    expect(third.output().indexOf("(already decided)")).toBeLessThan(third.output().indexOf("worker started"));
    const url = third.output().match(/Dashboard: (http:\/\/[^\s]+)/)![1];
    const response = await fetch(`${url}/api/companies/company_1/execution-events`);
    expect(response.ok).toBe(true);
    expect(await response.json()).toMatchObject({ pending: 0, decisions: [{ id: decision.id, sourceEventId: event.id }] });
    expect(repositories.listRecoveryDecisions("company_1")).toHaveLength(1);
    expect(repositories.listOutboxEvents({ companyId: "company_1" })).toHaveLength(1);

    await until(() => existsSync(writer.writer));
    const bytes = statSync(writer.writer).size;
    await until(() => statSync(writer.writer).size > bytes);
    expect(repositories.listWorkspaceClaims()[0]).toMatchObject({ workspacePath: writer.workspace, isolatedReason: expect.stringContaining("not been confirmed stopped") });
    expect(repositories.acquireWorkspaceClaim({
      workspacePath: writer.workspace, taskId: "another_task", runId: "another_run", ownerId: "another_worker", ownerEpoch: 1,
      acquiredAt: "2099-01-01T00:00:00.000Z", leaseExpiresAt: "2099-01-01T01:00:00.000Z", now: "2099-01-01T00:00:00.000Z",
    })).toBe(false);
    expect(repositories.listRunningAgentRuns("company_1")).toHaveLength(0);
    expect(client.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE task_id = ?").get("task_1")).toMatchObject({ n: 1 });
    expect(JSON.parse(readFileSync(join(root, "writer.json"), "utf8")).pid).toBe(writerPid);
  } finally {
    client.exec("DROP TRIGGER IF EXISTS fail_outbox; DROP TRIGGER IF EXISTS fail_ack");
    for (const { child } of children) await stop(child);
    // Also read the cleanup receipt if an assertion failed just before assigning writerPid.
    if (!writerPid && existsSync(join(root, "writer.json"))) writerPid = JSON.parse(readFileSync(join(root, "writer.json"), "utf8")).pid;
    if (writerPid) { try { process.kill(-writerPid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } }
    client.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

async function stop(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill(signal);
  const timeout = setTimeout(() => child.kill("SIGKILL"), 7_000);
  try { await exited; } finally { clearTimeout(timeout); }
}
