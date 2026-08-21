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
      artifact_workspace_path TEXT,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      latest_failure_reason TEXT,
      latest_failure_message TEXT,
      latest_execution_profile_name TEXT,
      latest_requested_timeout_ms INTEGER,
      latest_effective_timeout_ms INTEGER,
      dependency_note TEXT
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
      finished_at TEXT,
      execution_profile_name TEXT,
      requested_timeout_ms INTEGER,
      effective_timeout_ms INTEGER,
      failure_reason TEXT,
      failure_message TEXT
    );

    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      handoff_contract TEXT,
      PRIMARY KEY (task_id, depends_on_task_id)
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT,
      failure_reason TEXT,
      failure_message TEXT,
      execution_profile_name TEXT,
      requested_timeout_ms INTEGER,
      effective_timeout_ms INTEGER,
      dependency_note TEXT,
      artifact_workspace_path TEXT
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

    CREATE TABLE IF NOT EXISTS replan_proposals (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      source_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      proposal_source TEXT NOT NULL DEFAULT 'deterministic_template',
      planner_agent_id TEXT,
      planner_prompt_path TEXT,
      planner_failure_reason TEXT,
      planner_failure_message TEXT,
      rationale TEXT NOT NULL,
      replacement_tasks TEXT NOT NULL,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );
  `);
  migrateTaskPosition(database);
  migrateTasksExecutionFields(database);
  migrateAgentRunsExecutionFields(database);
  migrateTaskDependencyContracts(database);
  migrateReplanProposalDiagnostics(database);
  database.exec("CREATE INDEX IF NOT EXISTS tasks_company_position_idx ON tasks(company_id, position)");
  database.exec("CREATE INDEX IF NOT EXISTS task_dependencies_depends_on_idx ON task_dependencies(depends_on_task_id)");
  database.exec("CREATE INDEX IF NOT EXISTS task_events_company_created_idx ON task_events(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS replan_proposals_company_status_idx ON replan_proposals(company_id, status)");
}

function migrateReplanProposalDiagnostics(database: DatabaseClient): void {
  const columns = getColumnNames(database, "replan_proposals");
  addColumnIfMissing(database, columns, "replan_proposals", "proposal_source TEXT NOT NULL DEFAULT 'deterministic_template'");
  addColumnIfMissing(database, columns, "replan_proposals", "planner_agent_id TEXT");
  addColumnIfMissing(database, columns, "replan_proposals", "planner_prompt_path TEXT");
  addColumnIfMissing(database, columns, "replan_proposals", "planner_failure_reason TEXT");
  addColumnIfMissing(database, columns, "replan_proposals", "planner_failure_message TEXT");
}

function migrateTaskPosition(database: DatabaseClient): void {
  const columns = database.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  const hasPosition = columns.some((column) => column.name === "position");

  if (hasPosition) {
    return;
  }

  database.exec("ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
  backfillTaskPositions(database);
}

function backfillTaskPositions(database: DatabaseClient): void {
  const companies = database
    .prepare("SELECT DISTINCT company_id FROM tasks ORDER BY company_id ASC")
    .all() as Array<{ company_id: string }>;
  const selectTasks = database.prepare("SELECT id FROM tasks WHERE company_id = ? ORDER BY rowid ASC");
  const updatePosition = database.prepare("UPDATE tasks SET position = ? WHERE id = ?");

  for (const company of companies) {
    const tasks = selectTasks.all(company.company_id) as Array<{ id: string }>;

    tasks.forEach((task, index) => {
      updatePosition.run(index, task.id);
    });
  }
}

function migrateTasksExecutionFields(database: DatabaseClient): void {
  const columns = getColumnNames(database, "tasks");
  addColumnIfMissing(database, columns, "tasks", "artifact_workspace_path TEXT");
  addColumnIfMissing(database, columns, "tasks", "latest_failure_reason TEXT");
  addColumnIfMissing(database, columns, "tasks", "latest_failure_message TEXT");
  addColumnIfMissing(database, columns, "tasks", "latest_execution_profile_name TEXT");
  addColumnIfMissing(database, columns, "tasks", "latest_requested_timeout_ms INTEGER");
  addColumnIfMissing(database, columns, "tasks", "latest_effective_timeout_ms INTEGER");
  addColumnIfMissing(database, columns, "tasks", "dependency_note TEXT");
}

function migrateAgentRunsExecutionFields(database: DatabaseClient): void {
  const columns = getColumnNames(database, "agent_runs");
  addColumnIfMissing(database, columns, "agent_runs", "execution_profile_name TEXT");
  addColumnIfMissing(database, columns, "agent_runs", "requested_timeout_ms INTEGER");
  addColumnIfMissing(database, columns, "agent_runs", "effective_timeout_ms INTEGER");
  addColumnIfMissing(database, columns, "agent_runs", "failure_reason TEXT");
  addColumnIfMissing(database, columns, "agent_runs", "failure_message TEXT");
}

function migrateTaskDependencyContracts(database: DatabaseClient): void {
  const columns = getColumnNames(database, "task_dependencies");
  addColumnIfMissing(database, columns, "task_dependencies", "handoff_contract TEXT");
}

function addColumnIfMissing(
  database: DatabaseClient,
  columns: Set<string>,
  table: string,
  definition: string,
): void {
  const columnName = definition.split(" ")[0];
  if (columns.has(columnName)) {
    return;
  }

  database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  columns.add(columnName);
}

function getColumnNames(database: DatabaseClient, table: string): Set<string> {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(columns.map((column) => column.name));
}
