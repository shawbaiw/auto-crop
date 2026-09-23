import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { DatabaseSync } from "node:sqlite";

/**
 * A local launch claim, not a time-based lease. A paused process must not lose its right to run.
 * SQLite serializes competing starters; an old claim is replaceable only when both recorded PIDs
 * are absent. PID reuse and permission failures conservatively refuse takeover. A worker is
 * recorded before its IPC start permission, so a parent crash cannot leave an unrecorded dispatcher.
 * Keep this database separate from state.sqlite: the claim is acquired before application migration.
 */
export function acquireSupervisorOwnership(path: string) {
  const database = new DatabaseSync(path);
  const token = randomUUID();
  const host = hostname();
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    database.exec(`CREATE TABLE IF NOT EXISTS ownership (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      token TEXT NOT NULL, host TEXT NOT NULL, supervisor_pid INTEGER NOT NULL, worker_pid INTEGER
    )`);
    database.exec("BEGIN IMMEDIATE");
    const previous = database.prepare("SELECT * FROM ownership WHERE singleton = 1").get() as
      | { host: string; supervisor_pid: number; worker_pid: number | null }
      | undefined;
    if (previous && (previous.host !== host || isPresent(previous.supervisor_pid)
      || (previous.worker_pid !== null && isPresent(previous.worker_pid)))) {
      throw new Error("Auto-Crop is already running, or its previous worker cannot be confirmed stopped. Stop the existing processes before starting this project again.");
    }
    database.prepare(`INSERT OR REPLACE INTO ownership VALUES (1, ?, ?, ?, NULL)`)
      .run(token, host, process.pid);
    database.exec("COMMIT");
  } catch (error) {
    database.close();
    throw error;
  }

  let closed = false;
  return {
    recordWorker(pid: number | null) {
      const result = database.prepare("UPDATE ownership SET worker_pid = ? WHERE singleton = 1 AND token = ?")
        .run(pid, token);
      if (result.changes !== 1) throw new Error("Supervisor ownership was lost.");
    },
    close() {
      if (closed) return;
      // A caller must wait for its worker to exit before releasing this claim.
      database.prepare("DELETE FROM ownership WHERE singleton = 1 AND token = ?").run(token);
      database.close();
      closed = true;
    },
  };
}

function isPresent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
