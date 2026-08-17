import type { DatabaseClient } from "../db/client";

export function acquireTaskLock(
  database: DatabaseClient,
  taskId: string,
  ownerId: string,
  acquiredAt: string,
): boolean {
  try {
    database
      .prepare("INSERT INTO task_locks (task_id, owner_id, acquired_at) VALUES (?, ?, ?)")
      .run(taskId, ownerId, acquiredAt);
    return true;
  } catch {
    return false;
  }
}

export function releaseTaskLock(database: DatabaseClient, taskId: string, ownerId: string): void {
  database.prepare("DELETE FROM task_locks WHERE task_id = ? AND owner_id = ?").run(taskId, ownerId);
}
