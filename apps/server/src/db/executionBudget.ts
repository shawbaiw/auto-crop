import type { DatabaseClient } from "./client";
import { BUDGET_POLICY_VERSION, type BudgetSnapshot } from "../runtime/budgetPolicy";

type RunBudgetRow = {
  run_id: string; task_id: string; owner_epoch: number; reserved_ms: number; consumed_ms: number;
  settled: number; estimated: number; seq: number; next_checkpoint_ms: number | null;
};

/** All mutations are synchronous. The caller's claim/settlement transaction owns reservation/refund. */
export function createExecutionBudgetStore(database: DatabaseClient) {
  const getRun = (runId: string) => database.prepare("SELECT * FROM run_budgets WHERE run_id = ?").get(runId) as RunBudgetRow | undefined;
  const getTask = (taskId: string) => database.prepare(`SELECT b.authorized_ms AS authorizedMs,
    COALESCE(SUM(CASE WHEN r.settled = 1 THEN r.consumed_ms ELSE 0 END), 0) AS consumedMs,
    COALESCE(SUM(CASE WHEN r.settled = 0 THEN r.reserved_ms ELSE 0 END), 0) AS reservedMs
    FROM task_budgets b LEFT JOIN run_budgets r ON r.task_id = b.task_id WHERE b.task_id = ? GROUP BY b.task_id`).get(taskId) as
    { authorizedMs: number; consumedMs: number; reservedMs: number } | undefined;
  const append = (row: RunBudgetRow, kind: string, at: string) => database.prepare(`INSERT INTO budget_ledger
    (run_id, seq, kind, consumed_ms, reserved_ms, estimated, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(row.run_id, row.seq, kind, row.consumed_ms, row.settled ? 0 : row.reserved_ms, row.estimated, at);
  return {
    getRun, getTask,
    requestStop(runId: string, reason: string, phase: string, at: string, usedMs: number): boolean {
      const result = database.prepare(`INSERT OR IGNORE INTO run_stop_requests(run_id, reason, phase, requested_at, consumed_ms)
        SELECT r.id, ?, ?, ?, ? FROM agent_runs r JOIN tasks t ON t.id = r.task_id
        WHERE r.id = ? AND r.status = 'running' AND r.owner_epoch = t.execution_epoch
          AND EXISTS (SELECT 1 FROM run_budgets b WHERE b.run_id = r.id AND b.settled = 0)`)
        .run(reason, phase, at, Math.ceil(usedMs), runId);
      return Boolean(result.changes);
    },
    stopRequest(runId: string) {
      return database.prepare("SELECT * FROM run_stop_requests WHERE run_id = ?").get(runId) as
        { run_id: string; reason: string; phase: string; requested_at: string; consumed_ms: number;
          termination_wait_ms: number | null; termination_confirmed: number | null } | undefined;
    },
    recordTerminationWait(runId: string, waitMs: number, confirmed?: boolean): void {
      database.prepare(`UPDATE run_stop_requests SET termination_wait_ms = ?, termination_confirmed = ? WHERE run_id = ?`)
        .run(Math.max(0, Math.ceil(waitMs)), confirmed === undefined ? null : confirmed ? 1 : 0, runId);
    },
    authorization(id: string) {
      return database.prepare("SELECT * FROM budget_authorizations WHERE id = ?").get(id) as
        { id: string; task_id: string; additional_ms: number; authorized_before_ms: number; authorized_after_ms: number;
          reason: string; actor: string; created_at: string } | undefined;
    },
    lockAuthorization(taskId: string): boolean {
      return Boolean(database.prepare("UPDATE task_budgets SET authorized_ms = authorized_ms WHERE task_id = ?").run(taskId).changes);
    },
    authorize(input: { id: string; taskId: string; additionalMs: number; reason: string; at: string }): void {
      const before = getTask(input.taskId)!;
      const after = before.authorizedMs + input.additionalMs;
      if (!Number.isSafeInteger(after)) throw new Error("Authorization exceeds safe integer range");
      database.prepare(`INSERT INTO budget_authorizations(id, task_id, additional_ms, authorized_before_ms,
        authorized_after_ms, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, 'founder', ?)`)
        .run(input.id, input.taskId, input.additionalMs, before.authorizedMs, after, input.reason, input.at);
      database.prepare("UPDATE task_budgets SET authorized_ms = ? WHERE task_id = ?").run(after, input.taskId);
    },
    ownerBlocked(ownerId: string): boolean {
      return Boolean(database.prepare("SELECT 1 FROM budget_owner_guards WHERE owner_id = ?").get(ownerId));
    },
    blockOwner(runId: string, at: string): void {
      database.prepare(`INSERT OR IGNORE INTO budget_owner_guards(owner_id, detected_at)
        SELECT owner_id, ? FROM agent_runs WHERE id = ? AND owner_id IS NOT NULL`).run(at, runId);
    },
    snapshot(runId: string): BudgetSnapshot | null {
      const row = database.prepare("SELECT policy_version, budget_snapshot FROM agent_runs WHERE id = ?").get(runId) as
        { policy_version: string | null; budget_snapshot: string | null } | undefined;
      if (!row) return null;
      if (row.policy_version !== BUDGET_POLICY_VERSION) {
        if (row.budget_snapshot) throw new Error(`Unsupported budget policy for ${runId}`);
        return null;
      }
      if (!row.budget_snapshot) throw new Error(`Missing pinned budget for ${runId}`);
      return JSON.parse(row.budget_snapshot) as BudgetSnapshot;
    },
    reserve(runId: string, taskId: string, epoch: number, snapshot: BudgetSnapshot, at: string): number {
      database.prepare("INSERT OR IGNORE INTO task_budgets(task_id, authorized_ms) VALUES (?, ?)").run(taskId, snapshot.taskTotalMs);
      const task = getTask(taskId)!;
      const available = Math.min(snapshot.runHardMs, task.authorizedMs - task.consumedMs - task.reservedMs);
      if (available <= 0) throw new Error("Task execution budget has no unreserved balance");
      database.prepare(`INSERT INTO run_budgets(run_id, task_id, owner_epoch, reserved_ms, consumed_ms, settled, estimated, seq)
        VALUES (?, ?, ?, ?, 0, 0, 0, 0)`).run(runId, taskId, epoch, available);
      database.prepare("UPDATE agent_runs SET policy_version = ?, budget_snapshot = ? WHERE id = ?")
        .run(BUDGET_POLICY_VERSION, JSON.stringify({ ...snapshot, taskTotalMs: task.authorizedMs }), runId);
      append(getRun(runId)!, "reserved", at);
      return available;
    },
    checkpoint(runId: string, usedMs: number, at: string, nextCheckpointMs: number | null, review: boolean): boolean {
      const updated = database.prepare(`UPDATE run_budgets SET consumed_ms = MIN(reserved_ms, MAX(consumed_ms, ?)),
        next_checkpoint_ms = ?, seq = seq + 1 WHERE run_id = ? AND settled = 0
        AND EXISTS (SELECT 1 FROM agent_runs r JOIN tasks t ON t.id = r.task_id
          WHERE r.id = run_budgets.run_id AND r.status = 'running' AND t.execution_epoch = run_budgets.owner_epoch
          AND EXISTS (SELECT 1 FROM task_locks l WHERE l.run_id = r.id AND l.owner_id = r.owner_id AND l.owner_epoch = r.owner_epoch)
          AND EXISTS (SELECT 1 FROM workspace_claims w WHERE w.run_id = r.id AND w.owner_id = r.owner_id AND w.isolated_reason IS NULL))`)
        .run(Math.ceil(usedMs), nextCheckpointMs, runId);
      if (!updated.changes) return false;
      append(getRun(runId)!, review ? "budget_review" : "consumed", at);
      return true;
    },
    settle(runId: string, at: string, usedMs?: number): void {
      // Unknown consumption never becomes zero. Lost owners and external stop paths spend the whole
      // reservation; only the owning monotonic meter may refund unused time.
      const updated = database.prepare(`UPDATE run_budgets SET consumed_ms = CASE WHEN ? IS NULL THEN reserved_ms
        ELSE MIN(reserved_ms, MAX(consumed_ms, ?)) END, estimated = ?, settled = 1, seq = seq + 1
        WHERE run_id = ? AND settled = 0`).run(usedMs ?? null, usedMs === undefined ? null : Math.ceil(usedMs), usedMs === undefined ? 1 : 0, runId);
      if (updated.changes) append(getRun(runId)!, "settled", at);
      const policy = database.prepare("SELECT policy_version FROM agent_runs WHERE id = ?").get(runId) as { policy_version: string } | undefined;
      if (policy?.policy_version === BUDGET_POLICY_VERSION && !getRun(runId)) throw new Error(`Missing budget reservation for ${runId}`);
    },
    ledger(runId: string) {
      return database.prepare("SELECT * FROM budget_ledger WHERE run_id = ? ORDER BY seq").all(runId);
    },
  };
}
