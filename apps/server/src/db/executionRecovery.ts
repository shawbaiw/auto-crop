import type { DatabaseClient } from "./client";

export type RecoveryEntry = {
  sourceEventId: string; taskId: string; sourceRunId: string; dueAt: string;
  state: string; manifest: string; reason: string | null; nextRunId: string | null;
};
const columns = `source_event_id AS sourceEventId, task_id AS taskId, source_run_id AS sourceRunId,
  due_at AS dueAt, state, manifest, reason, next_run_id AS nextRunId`;

export function createExecutionRecoveryStore(database: DatabaseClient) {
  return {
    lock(): void {
      // Acquire the SQLite writer before reading eligibility, including on separate connections.
      database.prepare("UPDATE execution_recoveries SET state = state WHERE 0").run();
    },
    get(taskId: string): RecoveryEntry | undefined {
      return database.prepare(`SELECT ${columns} FROM execution_recoveries WHERE task_id = ?`).get(taskId) as RecoveryEntry | undefined;
    },
    pending(at: string): RecoveryEntry[] {
      return database.prepare(`SELECT ${columns} FROM execution_recoveries WHERE state = 'pending' AND due_at <= ? ORDER BY due_at LIMIT 20`).all(at) as RecoveryEntry[];
    },
    schedule(entry: { sourceEventId: string; taskId: string; sourceRunId: string; dueAt: string; manifest: string }): void {
      database.prepare(`INSERT INTO execution_recoveries(source_event_id, task_id, source_run_id, due_at, manifest)
        VALUES (?, ?, ?, ?, ?)`).run(entry.sourceEventId, entry.taskId, entry.sourceRunId, entry.dueAt, entry.manifest);
    },
    finish(taskId: string, state: "queued" | "blocked", reason: string): void {
      database.prepare("UPDATE execution_recoveries SET state = ?, reason = ? WHERE task_id = ? AND state = 'pending'").run(state, reason, taskId);
    },
    bind(taskId: string, runId: string): void {
      database.prepare("UPDATE execution_recoveries SET next_run_id = ?, state = 'started' WHERE task_id = ? AND state = 'queued' AND next_run_id IS NULL").run(runId, taskId);
    },
    source(runId: string) {
      return database.prepare(`SELECT r.task_id AS taskId, r.status, r.owner_epoch AS ownerEpoch,
        t.execution_epoch AS currentEpoch, r.phase, r.failure_reason AS failureReason,
        r.launch_isolation AS launchIsolation, r.agent_id AS agentId,
        (SELECT COUNT(*) FROM agent_runs history WHERE history.task_id = r.task_id AND history.id != r.id) AS priorRuns
        FROM agent_runs r JOIN tasks t ON t.id = r.task_id WHERE r.id = ?`).get(runId) as
        { taskId: string; status: string; ownerEpoch: number | null; currentEpoch: number; phase: string | null;
          failureReason: string | null; priorRuns: number; launchIsolation: string | null; agentId: string } | undefined;
    },
    list(companyId: string): RecoveryEntry[] {
      return database.prepare(`SELECT ${columns} FROM execution_recoveries WHERE task_id IN
        (SELECT id FROM tasks WHERE company_id = ?) ORDER BY due_at`).all(companyId) as RecoveryEntry[];
    },
  };
}
