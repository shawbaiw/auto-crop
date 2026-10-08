import type { DatabaseClient } from "./client";

export function migrate(database: DatabaseClient): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      founder_vision TEXT NOT NULL,
      locale TEXT NOT NULL DEFAULT 'en',
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

    CREATE TABLE IF NOT EXISTS task_holds (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      resolver TEXT NOT NULL,
      subject_kind TEXT,
      subject_id TEXT,
      reason TEXT NOT NULL,
      reason_text TEXT,
      opened_at TEXT NOT NULL,
      resolved_at TEXT,
      resolution TEXT
    );

    CREATE TABLE IF NOT EXISTS task_locks (
      task_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verification_reworks (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      verifier_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      failed_artifact_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      decision TEXT NOT NULL,
      producer_task_ids TEXT NOT NULL,
      redelivered_task_ids TEXT NOT NULL,
      failed_checks TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (verifier_task_id, failed_artifact_id)
    );

    CREATE TABLE IF NOT EXISTS verification_handoffs (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      inputs TEXT NOT NULL,
      prepared_at TEXT NOT NULL
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

    -- One launch of an agent process within a run (ADR 0035 / execution-health P1). A run's brief,
    -- its substantive work and its Artifact Syntax Repair are separate invocations of the same run,
    -- so "how long did it take" and "what ended it" are answerable per phase rather than per run.
    CREATE TABLE IF NOT EXISTS run_health (
      run_id TEXT PRIMARY KEY REFERENCES agent_runs(id),
      state TEXT NOT NULL, reason TEXT NOT NULL, action TEXT NOT NULL, checked_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_stop_requests (
      run_id TEXT PRIMARY KEY REFERENCES agent_runs(id),
      reason TEXT NOT NULL,
      phase TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      consumed_ms INTEGER NOT NULL,
      termination_wait_ms INTEGER,
      termination_confirmed INTEGER
    );
    CREATE TABLE IF NOT EXISTS budget_authorizations (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES task_budgets(task_id),
      additional_ms INTEGER NOT NULL CHECK (additional_ms >= 0),
      authorized_before_ms INTEGER NOT NULL,
      authorized_after_ms INTEGER NOT NULL,
      reason TEXT NOT NULL,
      actor TEXT NOT NULL CHECK (actor = 'founder'),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS budget_owner_guards (owner_id TEXT PRIMARY KEY, detected_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_budgets (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id),
      authorized_ms INTEGER NOT NULL CHECK (authorized_ms > 0)
    );
    CREATE TABLE IF NOT EXISTS run_budgets (
      run_id TEXT PRIMARY KEY REFERENCES agent_runs(id),
      task_id TEXT NOT NULL REFERENCES task_budgets(task_id),
      owner_epoch INTEGER NOT NULL,
      reserved_ms INTEGER NOT NULL CHECK (reserved_ms > 0),
      consumed_ms INTEGER NOT NULL CHECK (consumed_ms >= 0 AND consumed_ms <= reserved_ms),
      settled INTEGER NOT NULL DEFAULT 0,
      estimated INTEGER NOT NULL DEFAULT 0,
      seq INTEGER NOT NULL DEFAULT 0,
      next_checkpoint_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS run_budgets_task ON run_budgets(task_id);
    CREATE TABLE IF NOT EXISTS budget_ledger (
      run_id TEXT NOT NULL REFERENCES run_budgets(run_id),
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      consumed_ms INTEGER NOT NULL,
      reserved_ms INTEGER NOT NULL,
      estimated INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    );

    CREATE TABLE IF NOT EXISTS run_invocations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      phase TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      end_reason TEXT
    );

    -- Bounded activity summaries, never raw output. High-frequency deltas are aggregated in memory
    -- and landed at most once per flush window; the window keeps its own longest gap so throttling
    -- cannot make a silent run look busy. Observation only: nothing here ends a run.
    CREATE TABLE IF NOT EXISTS run_activity (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      invocation_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      window_started_at TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      phase TEXT NOT NULL,
      channel TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      max_gap_ms INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_run_activity_run ON run_activity(run_id, seq);

    -- Who may write a directory (execution-health P2b/P2c). The task lock guards a task; it cannot
    -- guard a directory, and two different tasks legitimately run in one: a consumer continues in its
    -- producer's artifact workspace. Keyed by the path itself, because the path is what is contended.
    CREATE TABLE IF NOT EXISTS workspace_claims (
      workspace_path TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      run_id TEXT,
      owner_id TEXT NOT NULL,
      owner_epoch INTEGER,
      acquired_at TEXT NOT NULL,
      lease_expires_at TEXT,
      -- Set when a run that held this directory could not be confirmed dead. The claim then outlives
      -- its run on purpose: nothing may write here until a person says the process is gone.
      isolated_reason TEXT
    );

    -- Events that must survive the process that produced them (execution-health P3). Written in the
    -- same transaction as the state change they describe, so there is never a settled run with no
    -- event or an event for a settlement that rolled back. Delivery is at-least-once: consumers are
    -- idempotent on the event id, and nothing here claims exactly-once across a process boundary.
    CREATE TABLE IF NOT EXISTS outbox_events (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      type TEXT NOT NULL,
      company_id TEXT NOT NULL,
      task_id TEXT,
      run_id TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      -- Who is currently trying to deliver it, and until when. A dispatcher that dies mid-delivery
      -- leaves a claim that expires, so another one picks the event up rather than it being stuck.
      claimed_by TEXT,
      claim_expires_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error TEXT,
      delivered_at TEXT,
      dead_lettered_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(delivered_at, dead_lettered_at, next_attempt_at);

    -- One recovery decision per source event, ever (execution-health section 8.2). The uniqueness is the
    -- whole mechanism: at-least-once delivery means a consumer will see the same failure twice, and
    -- without this each delivery would queue another replacement execution.
    CREATE TABLE IF NOT EXISTS recovery_decisions (
      id TEXT PRIMARY KEY,
      source_event_id TEXT NOT NULL UNIQUE,
      company_id TEXT NOT NULL,
      task_id TEXT,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS execution_recoveries (
      source_event_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
      source_run_id TEXT NOT NULL,
      due_at TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      manifest TEXT NOT NULL,
      reason TEXT,
      next_run_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_execution_recoveries_due ON execution_recoveries(state, due_at);

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
      execution_report TEXT,
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

    CREATE TABLE IF NOT EXISTS founder_decision_resolutions (
      founder_decision_id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      chosen_option TEXT,
      return_reason TEXT,
      note TEXT,
      resolved_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS founder_reports (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      classification TEXT NOT NULL,
      sections TEXT NOT NULL,
      generated_by TEXT NOT NULL,
      is_current INTEGER NOT NULL,
      supersedes_report_id TEXT REFERENCES founder_reports(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS founder_report_jobs (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      failure_message TEXT
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      action_type TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      decided_at TEXT,
      note TEXT
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
  // Which run a lock is held for (ADR 0034 / execution-health P2a). A lock taken before its run
  // exists carries NULL until `bindTaskLockToRun` fills it in, and legacy rows keep NULL forever;
  // both release conditionally on the value, so a dispatch can only ever release its own lock.
  {
    const lockColumns = getColumnNames(database, "task_locks");
    addColumnIfMissing(database, lockColumns, "task_locks", "run_id TEXT");
    // A lease, so a lock left by a dispatch that died is reclaimable rather than permanent, and the
    // ownership generation it was taken under, so a later owner's writes cannot be mistaken for an
    // earlier one's (execution-health P2b). Legacy rows have NULL for both, which reads as expired.
    addColumnIfMissing(database, lockColumns, "task_locks", "lease_expires_at TEXT");
    addColumnIfMissing(database, lockColumns, "task_locks", "owner_epoch INTEGER");
  }
  // What an invocation's activity said, kept after the activity windows themselves are swept
  // (execution-health retention). Null until compacted: a live or recent invocation is read from
  // run_activity, and "not compacted" must never be confused with "nothing was heard".
  {
    const invocationColumns = getColumnNames(database, "run_invocations");
    for (const column of [
      "activity_compacted_at TEXT", "activity_summary_count INTEGER", "first_activity_after_ms INTEGER",
      "longest_gap_ms INTEGER", "trailing_silence_ms INTEGER", "stdout_bytes INTEGER", "stderr_bytes INTEGER",
    ]) addColumnIfMissing(database, invocationColumns, "run_invocations", column);
  }
  database.exec("CREATE INDEX IF NOT EXISTS idx_run_activity_invocation ON run_activity(invocation_id)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_run_invocations_run ON run_invocations(run_id)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_outbox_delivered ON outbox_events(delivered_at)");
  addColumnIfMissing(database, getColumnNames(database, "run_stop_requests"), "run_stop_requests", "cancel_requested INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, getColumnNames(database, "agent_runs"), "agent_runs", "manual_termination_confirmed_at TEXT");
  addColumnIfMissing(database, getColumnNames(database, "task_events"), "task_events", "execution_brief TEXT");
  addColumnIfMissing(database, getColumnNames(database, "task_events"), "task_events", "blocked_by_task_id TEXT");
  addColumnIfMissing(database, getColumnNames(database, "company_events"), "company_events", "plan_snapshot TEXT");
  migrateTaskPosition(database);
  migrateCompanyPermissionMode(database);
  migrateCompanyLocale(database);
  migrateCompanyCreationFields(database);
  migrateTasksExecutionFields(database);
  migrateTaskHierarchyFields(database);
  migrateAgentRunsExecutionFields(database);
  migrateTaskDependencyContracts(database);
  migrateBusinessArtifactClassificationFields(database);
  migrateTaskCompletionAcceptanceProvenance(database);
  migrateTaskCompletionOutcomeSummary(database);
  migrateTaskCompletionExecutionReport(database);
  migrateReplanProposalDiagnostics(database);
  migrateLocalizedBusinessContentFields(database);
  migrateApprovalDecisionFields(database);
  database.exec("CREATE INDEX IF NOT EXISTS tasks_company_position_idx ON tasks(company_id, position)");
  database.exec("CREATE INDEX IF NOT EXISTS task_dependencies_depends_on_idx ON task_dependencies(depends_on_task_id)");
  // Open Holds are read on every task summary and every affordance guard, so the hot lookup is
  // "open Holds for this task"; the company index backs the per-company reconciliation pass.
  database.exec("CREATE INDEX IF NOT EXISTS task_holds_task_open_idx ON task_holds(task_id, resolved_at)");
  database.exec("CREATE INDEX IF NOT EXISTS task_holds_company_open_idx ON task_holds(company_id, resolved_at)");
  database.exec("CREATE INDEX IF NOT EXISTS task_events_company_created_idx ON task_events(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS companies_creation_idempotency_key_idx ON companies(creation_idempotency_key)");
  database.exec("CREATE INDEX IF NOT EXISTS creation_attempts_company_started_idx ON creation_attempts(company_id, started_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS company_events_company_created_idx ON company_events(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS task_progress_events_company_created_idx ON task_progress_events(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS task_progress_events_parent_created_idx ON task_progress_events(parent_task_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS task_completion_events_company_created_idx ON task_completion_events(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS human_action_confirmations_company_idx ON human_action_confirmations(company_id, human_action_id)");
  database.exec("CREATE INDEX IF NOT EXISTS founder_decision_resolutions_company_idx ON founder_decision_resolutions(company_id, founder_decision_id)");
  database.exec("CREATE INDEX IF NOT EXISTS founder_decision_resolutions_task_idx ON founder_decision_resolutions(task_id)");
  database.exec("CREATE INDEX IF NOT EXISTS replan_proposals_company_status_idx ON replan_proposals(company_id, status)");
  database.exec("CREATE INDEX IF NOT EXISTS ceo_intakes_company_created_idx ON ceo_intakes(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS ceo_review_decisions_company_created_idx ON ceo_review_decisions(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS ceo_review_decisions_task_created_idx ON ceo_review_decisions(task_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS business_artifacts_task_current_idx ON business_artifacts(task_id, is_current)");
  database.exec("CREATE INDEX IF NOT EXISTS business_artifacts_company_created_idx ON business_artifacts(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS founder_reports_company_current_idx ON founder_reports(company_id, is_current)");
  database.exec("CREATE INDEX IF NOT EXISTS founder_reports_company_created_idx ON founder_reports(company_id, created_at, id)");
  database.exec("CREATE INDEX IF NOT EXISTS founder_report_jobs_company_status_idx ON founder_report_jobs(company_id, status)");
  database.exec("CREATE INDEX IF NOT EXISTS founder_report_jobs_status_created_idx ON founder_report_jobs(status, created_at, id)");
}

/** Founder Approval outcomes are recorded, not just requested (ADR 0020 amendment). */
function migrateApprovalDecisionFields(database: DatabaseClient): void {
  const columns = getColumnNames(database, "approvals");
  addColumnIfMissing(database, columns, "approvals", "decided_at TEXT");
  addColumnIfMissing(database, columns, "approvals", "note TEXT");
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
  addColumnIfMissing(database, taskColumns, "tasks", "verification_requirements TEXT");
  addColumnIfMissing(database, taskColumns, "tasks", "decomposition TEXT");

  const dependencyColumns = getColumnNames(database, "task_dependencies");
  addColumnIfMissing(database, dependencyColumns, "task_dependencies", "handoff_contract_text TEXT");
  addColumnIfMissing(database, dependencyColumns, "task_dependencies", "input_role TEXT NOT NULL DEFAULT 'context'");

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

function migrateCompanyLocale(database: DatabaseClient): void {
  const columns = getColumnNames(database, "companies");
  addColumnIfMissing(database, columns, "companies", "locale TEXT NOT NULL DEFAULT 'en'");
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

function migrateTaskCompletionExecutionReport(database: DatabaseClient): void {
  const columns = getColumnNames(database, "task_completion_events");
  addColumnIfMissing(database, columns, "task_completion_events", "execution_report TEXT");
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
  // A monotonic counter of how many times this task has been claimed for execution. It only ever
  // increases, so an epoch identifies one generation of ownership for the life of the task — a lock
  // released and retaken is a new epoch, and anything still carrying the old one is stale.
  addColumnIfMissing(database, columns, "tasks", "execution_epoch INTEGER");
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
  // Observation (execution-health P1). All nullable: a run that predates observation reports unknown,
  // which is not the same as "no activity" and must never be read as one.
  addColumnIfMissing(database, columns, "agent_runs", "owner_id TEXT");
  addColumnIfMissing(database, columns, "agent_runs", "launch_isolation TEXT");
  addColumnIfMissing(database, columns, "agent_runs", "phase TEXT");
  addColumnIfMissing(database, columns, "agent_runs", "phase_started_at TEXT");
  addColumnIfMissing(database, columns, "agent_runs", "last_heartbeat_at TEXT");
  addColumnIfMissing(database, columns, "agent_runs", "last_activity_at TEXT");
  addColumnIfMissing(database, columns, "agent_runs", "policy_version TEXT");
  addColumnIfMissing(database, columns, "agent_runs", "budget_snapshot TEXT");
  // Which generation of ownership this run belongs to. A run whose epoch is not the task's current
  // one has been superseded, whatever its status says.
  addColumnIfMissing(database, columns, "agent_runs", "owner_epoch INTEGER");
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
  addColumnIfMissing(database, columns, "business_artifacts", "verification TEXT");
  addColumnIfMissing(database, columns, "business_artifacts", "delivery_workspace_path TEXT");
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
