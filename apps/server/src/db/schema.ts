import type { DatabaseClient } from "./client";

export function migrate(database: DatabaseClient): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      founder_vision TEXT NOT NULL,
      selected_ceo_agent_id TEXT NOT NULL,
      playbook_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      responsibility TEXT NOT NULL,
      lead_agent_id TEXT NOT NULL,
      memory_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS objectives (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS key_results (
      id TEXT PRIMARY KEY,
      objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      target_value TEXT NOT NULL,
      current_value TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      key_result_id TEXT REFERENCES key_results(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      assignee_agent_id TEXT NOT NULL,
      required_capabilities TEXT NOT NULL,
      proof_schema_id TEXT NOT NULL,
      workspace_path TEXT,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
    CREATE INDEX IF NOT EXISTS tasks_company_status_idx ON tasks(company_id, status);

    CREATE TABLE IF NOT EXISTS task_locks (
      task_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runtime_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS proofs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      uri TEXT NOT NULL,
      summary TEXT NOT NULL,
      verified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      log_path TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      action_type TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      review_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}
