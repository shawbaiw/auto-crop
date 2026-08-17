import { DatabaseSync } from "node:sqlite";

export type DatabaseClient = DatabaseSync;

export function createDatabaseClient(path: string): DatabaseClient {
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  return database;
}
