import type { DatabaseClient } from "./client";

export function migrate(database: DatabaseClient): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      founder_vision TEXT NOT NULL,
      selected_ceo_agent_id TEXT NOT NULL,
      playbook_id TEXT NOT NULL,
      permission_mode TEXT,
      status TEXT NOT NULL,
      creation_idempotency_key TEXT,
      creation_input TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS creation_attempts (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      prompt_path TEXT,
      failure_message TEXT
    );

    CREATE TABLE IF NOT EXISTS company_events (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      message_text TEXT,
      created_at TEXT NOT NULL,
      status TEXT
    );

    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      department_key TEXT,
      name TEXT NOT NULL,
      name_text TEXT,
      responsibility TEXT NOT NULL,
      responsibility_text TEXT,
      lead_agent_id TEXT NOT NULL,
      memory_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ceo_intakes (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ceo_review_decisions (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      decision TEXT NOT NULL,
      return_reason TEXT,
      note TEXT,
      note_text TEXT,
      proof_id TEXT REFERENCES proofs(id) ON DELETE SET NULL,
      proof_type TEXT,
      proof_uri TEXT,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS objectives (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      title_text TEXT,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS key_results (
      id TEXT PRIMARY KEY,
      objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      title_text TEXT,
      metric_name TEXT NOT NULL,
      target_value TEXT NOT NULL,
      target_value_text TEXT,
      current_value TEXT NOT NULL,
      current_value_text TEXT,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      department_key TEXT,
      key_result_id TEXT REFERENCES key_results(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      title_text TEXT,
      description TEXT NOT NULL,
      description_text TEXT,
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
      dependency_note TEXT,
      parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      task_kind TEXT NOT NULL DEFAULT 'parent',
      source TEXT NOT NULL DEFAULT 'ceo'
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
      summary_text TEXT,
      verified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS business_artifacts (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      source_proof_id TEXT REFERENCES proofs(id) ON DELETE SET NULL,
      artifact_kind TEXT NOT NULL DEFAULT 'deliverable',
      artifact_role TEXT NOT NULL DEFAULT 'none',
      artifact_subtype TEXT NOT NULL DEFAULT 'legacy',
      artifact_type TEXT NOT NULL,
      task_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      lineage TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      validation_errors TEXT NOT NULL,
      review_status TEXT NOT NULL,
      is_current INTEGER NOT NULL,
      supersedes_artifact_id TEXT REFERENCES business_artifacts(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
      handoff_contract_text TEXT,
      PRIMARY KEY (task_id, depends_on_task_id)
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      message_text TEXT,
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

    CREATE TABLE IF NOT EXISTS task_progress_events (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      parent_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      subject_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      step TEXT NOT NULL,
      status TEXT NOT NULL,
      label TEXT NOT NULL,
      label_text TEXT,
      detail TEXT,
      detail_text TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_completion_events (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      key_result_id TEXT REFERENCES key_results(id) ON DELETE SET NULL,
      business_artifact_id TEXT REFERENCES business_artifacts(id) ON DELETE SET NULL,
      outcome TEXT NOT NULL,
      acceptance_provenance TEXT,
      outcome_summary_text TEXT,
      dependency_impact TEXT NOT NULL,
      next_step_items TEXT NOT NULL,
      vision_gaps TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS human_action_confirmations (
      human_action_id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      evidence TEXT NOT NULL,
      status TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      verification_errors TEXT NOT NULL
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
  migrateCompanyPermissionMode(database);
  migrateCompanyCreationFields(database);
  migrateTasksExecutionFields(database);
  migrateTaskHierarchyFields(database);
  migrateAgentRunsExecutionFields(database);
  migrateTaskDependencyContracts(database);
  migrateBusinessArtifactClassificationFields(database);
  migrateTaskCompletionAcceptanceProvenance(database);
  migrateTaskCompletionOutcomeSummary(database);
  migrateReplanProposalDiagnostics(database);
  migrateLocalizedBusinessContentFields(database);
  database.exec("CREATE INDEX IF NOT EXISTS tasks_company_position_idx ON tasks(company_id, position)");
  database.exec("CREATE INDEX IF NOT EXISTS task_dependencies_depends_on_idx ON task_dependencies(depends_on_task_id)");
  database.exec("CREATE INDEX IF NOT EXISTS task_events_company_created_idx ON task_events(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS companies_creation_idempotency_key_idx ON companies(creation_idempotency_key)");
  database.exec("CREATE INDEX IF NOT EXISTS creation_attempts_company_started_idx ON creation_attempts(company_id, started_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS company_events_company_created_idx ON company_events(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS task_progress_events_company_created_idx ON task_progress_events(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS task_progress_events_parent_created_idx ON task_progress_events(parent_task_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS task_completion_events_company_created_idx ON task_completion_events(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS human_action_confirmations_company_idx ON human_action_confirmations(company_id, human_action_id)");
  database.exec("CREATE INDEX IF NOT EXISTS replan_proposals_company_status_idx ON replan_proposals(company_id, status)");
  database.exec("CREATE INDEX IF NOT EXISTS ceo_intakes_company_created_idx ON ceo_intakes(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS ceo_review_decisions_company_created_idx ON ceo_review_decisions(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS ceo_review_decisions_task_created_idx ON ceo_review_decisions(task_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS business_artifacts_task_current_idx ON business_artifacts(task_id, is_current)");
  database.exec("CREATE INDEX IF NOT EXISTS business_artifacts_company_created_idx ON business_artifacts(company_id, created_at, id)");
}

function migrateCompanyCreationFields(database: DatabaseClient): void {
  const columns = getColumnNames(database, "companies");
  addColumnIfMissing(database, columns, "companies", "creation_idempotency_key TEXT");
  addColumnIfMissing(database, columns, "companies", "creation_input TEXT");
}

function migrateLocalizedBusinessContentFields(database: DatabaseClient): void {
  const departmentColumns = getColumnNames(database, "departments");
  addColumnIfMissing(database, departmentColumns, "departments", "department_key TEXT");
  addColumnIfMissing(database, departmentColumns, "departments", "name_text TEXT");
  addColumnIfMissing(database, departmentColumns, "departments", "responsibility_text TEXT");

  const objectiveColumns = getColumnNames(database, "objectives");
  addColumnIfMissing(database, objectiveColumns, "objectives", "title_text TEXT");

  const keyResultColumns = getColumnNames(database, "key_results");
  addColumnIfMissing(database, keyResultColumns, "key_results", "title_text TEXT");
  addColumnIfMissing(database, keyResultColumns, "key_results", "target_value_text TEXT");
  addColumnIfMissing(database, keyResultColumns, "key_results", "current_value_text TEXT");

  const taskColumns = getColumnNames(database, "tasks");
  addColumnIfMissing(database, taskColumns, "tasks", "department_key TEXT");
  addColumnIfMissing(database, taskColumns, "tasks", "title_text TEXT");
  addColumnIfMissing(database, taskColumns, "tasks", "description_text TEXT");

  const dependencyColumns = getColumnNames(database, "task_dependencies");
  addColumnIfMissing(database, dependencyColumns, "task_dependencies", "handoff_contract_text TEXT");

  const ceoReviewDecisionColumns = getColumnNames(database, "ceo_review_decisions");
  addColumnIfMissing(database, ceoReviewDecisionColumns, "ceo_review_decisions", "note_text TEXT");

  const proofColumns = getColumnNames(database, "proofs");
  addColumnIfMissing(database, proofColumns, "proofs", "summary_text TEXT");

  const taskEventColumns = getColumnNames(database, "task_events");
  addColumnIfMissing(database, taskEventColumns, "task_events", "message_text TEXT");

  const taskProgressEventColumns = getColumnNames(database, "task_progress_events");
  addColumnIfMissing(database, taskProgressEventColumns, "task_progress_events", "label_text TEXT");
  addColumnIfMissing(database, taskProgressEventColumns, "task_progress_events", "detail_text TEXT");
}

function migrateCompanyPermissionMode(database: DatabaseClient): void {
  const columns = getColumnNames(database, "companies");
  addColumnIfMissing(database, columns, "companies", "permission_mode TEXT");
}

function migrateReplanProposalDiagnostics(database: DatabaseClient): void {
  const columns = getColumnNames(database, "replan_proposals");
  addColumnIfMissing(database, columns, "replan_proposals", "proposal_source TEXT NOT NULL DEFAULT 'deterministic_template'");
  addColumnIfMissing(database, columns, "replan_proposals", "planner_agent_id TEXT");
  addColumnIfMissing(database, columns, "replan_proposals", "planner_prompt_path TEXT");
  addColumnIfMissing(database, columns, "replan_proposals", "planner_failure_reason TEXT");
  addColumnIfMissing(database, columns, "replan_proposals", "planner_failure_message TEXT");
}

function migrateTaskCompletionAcceptanceProvenance(database: DatabaseClient): void {
  const columns = getColumnNames(database, "task_completion_events");
  addColumnIfMissing(database, columns, "task_completion_events", "acceptance_provenance TEXT");
}

function migrateTaskCompletionOutcomeSummary(database: DatabaseClient): void {
  const columns = getColumnNames(database, "task_completion_events");
  addColumnIfMissing(database, columns, "task_completion_events", "outcome_summary_text TEXT");
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

function migrateTaskHierarchyFields(database: DatabaseClient): void {
  const columns = getColumnNames(database, "tasks");
  addColumnIfMissing(database, columns, "tasks", "parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE");
  addColumnIfMissing(database, columns, "tasks", "task_kind TEXT NOT NULL DEFAULT 'parent'");
  addColumnIfMissing(database, columns, "tasks", "source TEXT NOT NULL DEFAULT 'ceo'");
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

function migrateBusinessArtifactClassificationFields(database: DatabaseClient): void {
  const columns = getColumnNames(database, "business_artifacts");
  addColumnIfMissing(database, columns, "business_artifacts", "artifact_kind TEXT NOT NULL DEFAULT 'deliverable'");
  addColumnIfMissing(database, columns, "business_artifacts", "artifact_role TEXT NOT NULL DEFAULT 'none'");
  addColumnIfMissing(database, columns, "business_artifacts", "artifact_subtype TEXT NOT NULL DEFAULT 'legacy'");
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
