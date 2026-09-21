import { DatabaseSync } from "node:sqlite";

export type DatabaseClient = DatabaseSync;

/**
 * How long a write waits for another connection's transaction before giving up.
 *
 * SQLite's default is zero: a second connection's write fails instantly while anyone else holds the
 * write lock. That was invisible while the whole runtime shared one connection, and stops being so
 * as soon as anything else opens the database — the out-of-process Supervisor, a CLI command, a
 * migration check. Waiting is the right answer for the contention this has: settlement transactions
 * are short and hold no awaits (ADR 0035).
 *
 * It does not, and cannot, rescue a transaction that read before it wrote: that failure is a stale
 * snapshot rather than a busy lock, and the fix is to take the write lock first.
 */
const BUSY_TIMEOUT_MS = 5_000;

export function createDatabaseClient(path: string): DatabaseClient {
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return database;
}
