import type {
  AgentRun,
  AgentFailureReason,
  Approval,
  BusinessArtifact,
  CeoIntake,
  CeoIntakeStatus,
  CeoReviewDecision,
  Company,
  Department,
  KeyResult,
  Objective,
  Proof,
  ReplanProposal,
  ReplanProposalStatus,
  Task,
  TaskDependency,
  TaskEvent,
  TaskEventType,
  TaskKind,
  TaskProgressEvent,
  TaskProgressStatus,
  TaskProgressStep,
  TaskSource,
  TaskStatus,
} from "@auto-crop/core";
import type { DatabaseClient } from "./client";

export type ReviewRecord = {
  id: string;
  companyId: string;
  summary: string;
  reviewPath: string;
  createdAt: string;
};

export function createRepositories(database: DatabaseClient) {
  return {
    createCompany(company: Company): void {
      database
        .prepare(
          `INSERT INTO companies (
            id, name, founder_vision, selected_ceo_agent_id, playbook_id, permission_mode, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          company.id,
          company.name,
          company.founderVision,
          company.selectedCeoAgentId,
          company.playbookId,
          company.permissionMode ?? null,
          company.status,
          company.createdAt,
          company.updatedAt,
        );
    },

    getCompany(id: string): Company | null {
      const row = database.prepare("SELECT * FROM companies WHERE id = ?").get(id);
      return row ? mapCompany(row as CompanyRow) : null;
    },

    listCompanies(): Company[] {
      const rows = database.prepare("SELECT * FROM companies ORDER BY updated_at DESC, created_at DESC").all();
      return rows.map((row) => mapCompany(row as CompanyRow));
    },

    updateCompanyStatus(id: string, status: Company["status"], updatedAt: string): void {
      database
        .prepare("UPDATE companies SET status = ?, updated_at = ? WHERE id = ?")
        .run(status, updatedAt, id);
    },

    createCeoIntake(intake: CeoIntake): void {
      database
        .prepare(
          `INSERT INTO ceo_intakes (
            id, company_id, body, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(intake.id, intake.companyId, intake.body, intake.status, intake.createdAt, intake.updatedAt);
    },

    listCeoIntakesForCompany(companyId: string): CeoIntake[] {
      const rows = database
        .prepare("SELECT * FROM ceo_intakes WHERE company_id = ? ORDER BY created_at ASC, id ASC")
        .all(companyId);
      return rows.map((row) => mapCeoIntake(row as CeoIntakeRow));
    },

    updateCeoIntakeStatus(id: string, status: CeoIntakeStatus, updatedAt: string): void {
      database
        .prepare("UPDATE ceo_intakes SET status = ?, updated_at = ? WHERE id = ?")
        .run(status, updatedAt, id);
    },

    createCeoReviewDecision(decision: CeoReviewDecision): void {
      database
        .prepare(
          `INSERT INTO ceo_review_decisions (
            id, company_id, task_id, department_id, decision, return_reason, note,
            proof_id, proof_type, proof_uri, actor, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          decision.id,
          decision.companyId,
          decision.taskId,
          decision.departmentId,
          decision.decision,
          decision.returnReason,
          decision.note,
          decision.proofId,
          decision.proofType,
          decision.proofUri,
          decision.actor,
          decision.createdAt,
        );
    },

    listCeoReviewDecisionsForCompany(companyId: string): CeoReviewDecision[] {
      const rows = database
        .prepare("SELECT * FROM ceo_review_decisions WHERE company_id = ? ORDER BY created_at ASC, id ASC")
        .all(companyId);
      return rows.map((row) => mapCeoReviewDecision(row as CeoReviewDecisionRow));
    },

    createDepartment(department: Department): void {
      database
        .prepare(
          `INSERT INTO departments (
            id, company_id, name, responsibility, lead_agent_id, memory_path
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          department.id,
          department.companyId,
          department.name,
          department.responsibility,
          department.leadAgentId,
          department.memoryPath,
        );
    },

    listDepartments(companyId: string): Department[] {
      const rows = database
        .prepare("SELECT * FROM departments WHERE company_id = ? ORDER BY id ASC")
        .all(companyId);
      return rows.map((row) => mapDepartment(row as DepartmentRow));
    },

    createObjective(objective: Objective): void {
      database
        .prepare(
          `INSERT INTO objectives (
            id, company_id, title, status, priority
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(objective.id, objective.companyId, objective.title, objective.status, objective.priority);
    },

    listObjectives(companyId: string): Objective[] {
      const rows = database
        .prepare("SELECT * FROM objectives WHERE company_id = ? ORDER BY priority ASC, id ASC")
        .all(companyId);
      return rows.map((row) => mapObjective(row as ObjectiveRow));
    },

    createKeyResult(keyResult: KeyResult): void {
      database
        .prepare(
          `INSERT INTO key_results (
            id, objective_id, title, metric_name, target_value, current_value, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          keyResult.id,
          keyResult.objectiveId,
          keyResult.title,
          keyResult.metricName,
          keyResult.targetValue,
          keyResult.currentValue,
          keyResult.status,
        );
    },

    listKeyResults(companyId: string): KeyResult[] {
      const rows = database
        .prepare(
          `SELECT key_results.*
           FROM key_results
           INNER JOIN objectives ON objectives.id = key_results.objective_id
           WHERE objectives.company_id = ?
           ORDER BY objectives.priority ASC, key_results.id ASC`,
        )
        .all(companyId);
      return rows.map((row) => mapKeyResult(row as KeyResultRow));
    },

    updateKeyResultProgress(id: string, currentValue: string, status: KeyResult["status"]): void {
      database
        .prepare("UPDATE key_results SET current_value = ?, status = ? WHERE id = ?")
        .run(currentValue, status, id);
    },

    updateObjectivePriority(id: string, priority: number): void {
      database.prepare("UPDATE objectives SET priority = ? WHERE id = ?").run(priority, id);
    },

    createTask(task: Task): void {
      database
        .prepare(
          `INSERT INTO tasks (
            id, company_id, department_id, key_result_id, title, description,
            assignee_agent_id, required_capabilities, proof_schema_id, workspace_path, artifact_workspace_path,
            status, risk_level, position, latest_failure_reason, latest_failure_message,
            latest_execution_profile_name, latest_requested_timeout_ms, latest_effective_timeout_ms,
            dependency_note, parent_task_id, task_kind, source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          task.id,
          task.companyId,
          task.departmentId,
          task.keyResultId,
          task.title,
          task.description,
          task.assigneeAgentId,
          JSON.stringify(task.requiredCapabilities),
          task.proofSchemaId,
          task.workspacePath,
          task.artifactWorkspacePath ?? null,
          task.status,
          task.riskLevel,
          task.position,
          task.latestFailureReason ?? null,
          task.latestFailureMessage ?? null,
          task.latestExecutionProfileName ?? null,
          task.latestRequestedTimeoutMs ?? null,
          task.latestEffectiveTimeoutMs ?? null,
          task.dependencyNote ?? null,
          task.parentTaskId ?? null,
          task.taskKind ?? "parent",
          task.source ?? "ceo",
        );
    },

    getTask(id: string): Task | null {
      const row = database.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
      return row ? mapTask(row as TaskRow) : null;
    },

    updateTaskStatus(id: string, status: TaskStatus): void {
      database.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id);
    },

    updateTaskExecutionSummary(
      id: string,
      summary: {
        latestFailureReason?: AgentFailureReason | null;
        latestFailureMessage?: string | null;
        latestExecutionProfileName?: string | null;
        latestRequestedTimeoutMs?: number | null;
        latestEffectiveTimeoutMs?: number | null;
        dependencyNote?: string | null;
        artifactWorkspacePath?: string | null;
      },
    ): void {
      const assignments: string[] = [];
      const values: Array<string | number | null> = [];
      const add = (column: string, value: string | number | null | undefined) => {
        if (value === undefined) {
          return;
        }
        assignments.push(`${column} = ?`);
        values.push(value);
      };

      add("latest_failure_reason", summary.latestFailureReason);
      add("latest_failure_message", summary.latestFailureMessage);
      add("latest_execution_profile_name", summary.latestExecutionProfileName);
      add("latest_requested_timeout_ms", summary.latestRequestedTimeoutMs);
      add("latest_effective_timeout_ms", summary.latestEffectiveTimeoutMs);
      add("dependency_note", summary.dependencyNote);
      add("artifact_workspace_path", summary.artifactWorkspacePath);

      if (assignments.length === 0) {
        return;
      }

      database
        .prepare(`UPDATE tasks SET ${assignments.join(", ")} WHERE id = ?`)
        .run(...values, id);
    },

    clearTaskDependencyNote(id: string): void {
      database.prepare("UPDATE tasks SET dependency_note = NULL WHERE id = ?").run(id);
    },

    updateTaskWorkspacePath(id: string, workspacePath: string): void {
      database.prepare("UPDATE tasks SET workspace_path = ? WHERE id = ?").run(workspacePath, id);
    },

    updateTaskArtifactWorkspacePath(id: string, artifactWorkspacePath: string): void {
      database
        .prepare("UPDATE tasks SET artifact_workspace_path = ? WHERE id = ?")
        .run(artifactWorkspacePath, id);
    },

    fetchQueuedTasks(limit: number): Task[] {
      const rows = database
        .prepare(
          `SELECT tasks.*
           FROM tasks
           INNER JOIN companies ON companies.id = tasks.company_id
           WHERE tasks.status IN ('queued', 'waiting_dependency', 'retrying')
           ORDER BY companies.created_at ASC, tasks.position ASC, tasks.id ASC
           LIMIT ?`,
        )
        .all(limit);
      return rows.map((row) => mapTask(row as TaskRow));
    },

    listTasksForCompany(companyId: string): Task[] {
      const rows = database
        .prepare("SELECT * FROM tasks WHERE company_id = ? ORDER BY position ASC, id ASC")
        .all(companyId);
      return rows.map((row) => mapTask(row as TaskRow));
    },

    appendTaskProgressEvent(event: TaskProgressEvent): void {
      database
        .prepare(
          `INSERT INTO task_progress_events (
            id, company_id, department_id, parent_task_id, subject_task_id, step, status, label, detail, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.companyId,
          event.departmentId,
          event.parentTaskId,
          event.subjectTaskId,
          event.step,
          event.status,
          event.label,
          event.detail,
          event.createdAt,
        );
    },

    listTaskProgressEventsForCompany(companyId: string): TaskProgressEvent[] {
      const rows = database
        .prepare(
          `SELECT *
           FROM task_progress_events
           WHERE company_id = ?
           ORDER BY created_at ASC, id ASC`,
        )
        .all(companyId);
      return rows.map((row) => mapTaskProgressEvent(row as TaskProgressEventRow));
    },

    listTaskProgressEventsForParentTask(parentTaskId: string): TaskProgressEvent[] {
      const rows = database
        .prepare(
          `SELECT *
           FROM task_progress_events
           WHERE parent_task_id = ?
           ORDER BY created_at ASC, id ASC`,
        )
        .all(parentTaskId);
      return rows.map((row) => mapTaskProgressEvent(row as TaskProgressEventRow));
    },

    createTaskDependency(dependency: TaskDependency): void {
      database
        .prepare(
          `INSERT INTO task_dependencies (task_id, depends_on_task_id, handoff_contract)
           VALUES (?, ?, ?)
           ON CONFLICT(task_id, depends_on_task_id) DO UPDATE SET
             handoff_contract = COALESCE(excluded.handoff_contract, task_dependencies.handoff_contract)`,
        )
        .run(dependency.taskId, dependency.dependsOnTaskId, dependency.handoffContract ?? null);
    },

    listTaskDependencies(taskId: string): TaskDependency[] {
      const rows = database
        .prepare(
          `SELECT task_id, depends_on_task_id, handoff_contract
           FROM task_dependencies
           WHERE task_id = ?
           ORDER BY depends_on_task_id ASC`,
        )
        .all(taskId);
      return rows.map((row) => mapTaskDependency(row as TaskDependencyRow));
    },

    replaceDependencyConsumers(previousDependsOnTaskId: string, nextDependsOnTaskId: string): void {
      database
        .prepare(
          `UPDATE OR IGNORE task_dependencies
           SET depends_on_task_id = ?
           WHERE depends_on_task_id = ?`,
        )
        .run(nextDependsOnTaskId, previousDependsOnTaskId);
      database
        .prepare(
          `DELETE FROM task_dependencies
           WHERE depends_on_task_id = ?`,
        )
        .run(previousDependsOnTaskId);
    },

    listTaskDependenciesForCompany(companyId: string): TaskDependency[] {
      const rows = database
        .prepare(
          `SELECT task_dependencies.task_id, task_dependencies.depends_on_task_id, task_dependencies.handoff_contract
           FROM task_dependencies
           INNER JOIN tasks ON tasks.id = task_dependencies.task_id
           WHERE tasks.company_id = ?
           ORDER BY tasks.position ASC, task_dependencies.depends_on_task_id ASC`,
        )
        .all(companyId);
      return rows.map((row) => mapTaskDependency(row as TaskDependencyRow));
    },

    listDependencyConsumers(dependsOnTaskId: string): Task[] {
      const rows = database
        .prepare(
          `SELECT tasks.*
           FROM tasks
           INNER JOIN task_dependencies ON task_dependencies.task_id = tasks.id
           WHERE task_dependencies.depends_on_task_id = ?
           ORDER BY tasks.position ASC, tasks.id ASC`,
        )
        .all(dependsOnTaskId);
      return rows.map((row) => mapTask(row as TaskRow));
    },

    getNextTaskPosition(companyId: string): number {
      const row = database
        .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM tasks WHERE company_id = ?")
        .get(companyId) as { next_position: number };
      return row.next_position;
    },

    acquireTaskLock(taskId: string, ownerId: string, acquiredAt: string): boolean {
      try {
        database
          .prepare("INSERT INTO task_locks (task_id, owner_id, acquired_at) VALUES (?, ?, ?)")
          .run(taskId, ownerId, acquiredAt);
        return true;
      } catch {
        return false;
      }
    },

    releaseTaskLock(taskId: string, ownerId: string): void {
      database
        .prepare("DELETE FROM task_locks WHERE task_id = ? AND owner_id = ?")
        .run(taskId, ownerId);
    },

    releaseAllTaskLocks(): string[] {
      const locks = this.listTaskLocks();
      database.prepare("DELETE FROM task_locks").run();
      return locks.map((lock) => lock.taskId);
    },

    listTaskLocks(): Array<{ taskId: string; ownerId: string; acquiredAt: string }> {
      const rows = database.prepare("SELECT * FROM task_locks ORDER BY task_id ASC").all();
      return rows.map((row) => {
        const lock = row as TaskLockRow;
        return {
          taskId: lock.task_id,
          ownerId: lock.owner_id,
          acquiredAt: lock.acquired_at,
        };
      });
    },

    setGlobalPaused(paused: boolean): void {
      database
        .prepare(
          `INSERT INTO runtime_state (key, value)
           VALUES ('global_paused', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(paused ? "true" : "false");
    },

    isGlobalPaused(): boolean {
      const row = database
        .prepare("SELECT value FROM runtime_state WHERE key = 'global_paused'")
        .get() as { value: string } | undefined;
      return row?.value === "true";
    },

    appendProof(proof: Proof): void {
      database
        .prepare(
          `INSERT INTO proofs (
            id, task_id, type, uri, summary, verified_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(proof.id, proof.taskId, proof.type, proof.uri, proof.summary, proof.verifiedAt);
    },

    listProofsForTask(taskId: string): Proof[] {
      const rows = database
        .prepare("SELECT * FROM proofs WHERE task_id = ? ORDER BY id ASC")
        .all(taskId);
      return rows.map((row) => mapProof(row as ProofRow));
    },

    listProofsForCompany(companyId: string): Proof[] {
      const rows = database
        .prepare(
          `SELECT proofs.*
           FROM proofs
           INNER JOIN tasks ON tasks.id = proofs.task_id
           WHERE tasks.company_id = ?
           ORDER BY tasks.position ASC, proofs.id ASC`,
        )
        .all(companyId);
      return rows.map((row) => mapProof(row as ProofRow));
    },

    createBusinessArtifact(artifact: BusinessArtifact): void {
      if (artifact.isCurrent) {
        database
          .prepare("UPDATE business_artifacts SET is_current = 0 WHERE task_id = ?")
          .run(artifact.taskId);
      }

      database
        .prepare(
          `INSERT INTO business_artifacts (
            id, company_id, task_id, source_proof_id, artifact_type, task_type,
            payload, lineage, validation_status, validation_errors, review_status,
            is_current, supersedes_artifact_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          artifact.id,
          artifact.companyId,
          artifact.taskId,
          artifact.sourceProofId,
          artifact.artifactType,
          artifact.taskType,
          JSON.stringify(artifact.payload),
          JSON.stringify(artifact.lineage),
          artifact.validationStatus,
          JSON.stringify(artifact.validationErrors),
          artifact.reviewStatus,
          artifact.isCurrent ? 1 : 0,
          artifact.supersedesArtifactId,
          artifact.createdAt,
          artifact.updatedAt,
        );
    },

    listBusinessArtifactsForTask(taskId: string): BusinessArtifact[] {
      const rows = database
        .prepare("SELECT * FROM business_artifacts WHERE task_id = ? ORDER BY created_at ASC, id ASC")
        .all(taskId);
      return rows.map((row) => mapBusinessArtifact(row as BusinessArtifactRow));
    },

    listBusinessArtifactsForCompany(companyId: string): BusinessArtifact[] {
      const rows = database
        .prepare(
          `SELECT *
           FROM business_artifacts
           WHERE company_id = ?
           ORDER BY created_at ASC, id ASC`,
        )
        .all(companyId);
      return rows.map((row) => mapBusinessArtifact(row as BusinessArtifactRow));
    },

    getCurrentBusinessArtifactForTask(taskId: string): BusinessArtifact | null {
      const row = database
        .prepare(
          `SELECT *
           FROM business_artifacts
           WHERE task_id = ? AND is_current = 1
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
        )
        .get(taskId);
      return row ? mapBusinessArtifact(row as BusinessArtifactRow) : null;
    },

    updateBusinessArtifactReviewStatus(id: string, reviewStatus: BusinessArtifact["reviewStatus"], updatedAt: string): void {
      database
        .prepare("UPDATE business_artifacts SET review_status = ?, updated_at = ? WHERE id = ?")
        .run(reviewStatus, updatedAt, id);
    },

    createApproval(approval: Approval): void {
      database
        .prepare(
          `INSERT INTO approvals (
            id, company_id, task_id, action_type, risk_level, status, requested_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          approval.id,
          approval.companyId,
          approval.taskId,
          approval.actionType,
          approval.riskLevel,
          approval.status,
          approval.requestedAt,
        );
    },

    createAgentRun(agentRun: AgentRun): void {
      database
        .prepare(
          `INSERT INTO agent_runs (
            id, task_id, agent_id, status, log_path, started_at, finished_at,
            execution_profile_name, requested_timeout_ms, effective_timeout_ms, failure_reason, failure_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          agentRun.id,
          agentRun.taskId,
          agentRun.agentId,
          agentRun.status,
          agentRun.logPath,
          agentRun.startedAt,
          agentRun.finishedAt,
          agentRun.executionProfileName ?? null,
          agentRun.requestedTimeoutMs ?? null,
          agentRun.effectiveTimeoutMs ?? null,
          agentRun.failureReason ?? null,
          agentRun.failureMessage ?? null,
        );
    },

    updateAgentRunStatus(
      id: string,
      status: AgentRun["status"],
      finishedAt: string | null,
      outcome: {
        failureReason?: AgentFailureReason | null;
        failureMessage?: string | null;
      } = {},
    ): void {
      database
        .prepare(
          `UPDATE agent_runs
           SET status = ?,
               finished_at = ?,
               failure_reason = COALESCE(?, failure_reason),
               failure_message = COALESCE(?, failure_message)
           WHERE id = ?`,
        )
        .run(status, finishedAt, outcome.failureReason ?? null, outcome.failureMessage ?? null, id);
    },

    listRunningAgentRuns(companyId: string): AgentRun[] {
      const rows = database
        .prepare(
          `SELECT agent_runs.*
           FROM agent_runs
           INNER JOIN tasks ON tasks.id = agent_runs.task_id
           WHERE tasks.company_id = ? AND agent_runs.status = 'running'
           ORDER BY agent_runs.id ASC`,
        )
        .all(companyId);
      return rows.map((row) => mapAgentRun(row as AgentRunRow));
    },

    createReview(review: ReviewRecord): void {
      database
        .prepare(
          `INSERT INTO reviews (
            id, company_id, summary, review_path, created_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(review.id, review.companyId, review.summary, review.reviewPath, review.createdAt);
    },

    listReviews(companyId: string): ReviewRecord[] {
      const rows = database
        .prepare("SELECT * FROM reviews WHERE company_id = ? ORDER BY created_at ASC, id ASC")
        .all(companyId);
      return rows.map((row) => mapReview(row as ReviewRow));
    },

    createReplanProposal(proposal: ReplanProposal): void {
      database
        .prepare(
          `INSERT INTO replan_proposals (
            id, company_id, source_task_id, status, proposal_source, planner_agent_id, planner_prompt_path,
            planner_failure_reason, planner_failure_message, rationale, replacement_tasks, created_at, confirmed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          proposal.id,
          proposal.companyId,
          proposal.sourceTaskId,
          proposal.status,
          proposal.proposalSource,
          proposal.plannerAgentId,
          proposal.plannerPromptPath,
          proposal.plannerFailureReason,
          proposal.plannerFailureMessage,
          proposal.rationale,
          JSON.stringify(proposal.replacementTasks),
          proposal.createdAt,
          proposal.confirmedAt,
        );
    },

    getReplanProposal(id: string): ReplanProposal | null {
      const row = database.prepare("SELECT * FROM replan_proposals WHERE id = ?").get(id);
      return row ? mapReplanProposal(row as ReplanProposalRow) : null;
    },

    listReplanProposalsForCompany(companyId: string): ReplanProposal[] {
      const rows = database
        .prepare("SELECT * FROM replan_proposals WHERE company_id = ? ORDER BY created_at ASC, id ASC")
        .all(companyId);
      return rows.map((row) => mapReplanProposal(row as ReplanProposalRow));
    },

    listReplanProposalsForTask(taskId: string): ReplanProposal[] {
      const rows = database
        .prepare("SELECT * FROM replan_proposals WHERE source_task_id = ? ORDER BY created_at ASC, id ASC")
        .all(taskId);
      return rows.map((row) => mapReplanProposal(row as ReplanProposalRow));
    },

    updateReplanProposalStatus(id: string, status: ReplanProposalStatus, confirmedAt: string | null): void {
      database
        .prepare("UPDATE replan_proposals SET status = ?, confirmed_at = ? WHERE id = ?")
        .run(status, confirmedAt, id);
    },

    appendTaskEvent(event: TaskEvent): void {
      database
        .prepare(
          `INSERT INTO task_events (
            id, company_id, task_id, type, message, created_at, status, failure_reason,
            failure_message, execution_profile_name, requested_timeout_ms, effective_timeout_ms,
            dependency_note, artifact_workspace_path
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.companyId,
          event.taskId,
          event.type,
          event.message,
          event.createdAt,
          event.status,
          event.failureReason,
          event.failureMessage,
          event.executionProfileName,
          event.requestedTimeoutMs,
          event.effectiveTimeoutMs,
          event.dependencyNote,
          event.artifactWorkspacePath,
        );
    },

    listTaskEventsForCompany(companyId: string): TaskEvent[] {
      const rows = database
        .prepare(
          `SELECT *
           FROM task_events
           WHERE company_id = ?
           ORDER BY created_at ASC, id ASC`,
        )
        .all(companyId);
      return rows.map((row) => mapTaskEvent(row as TaskEventRow));
    },
  };
}

type CompanyRow = {
  id: string;
  name: string;
  founder_vision: string;
  selected_ceo_agent_id: string;
  playbook_id: string;
  permission_mode: Company["permissionMode"];
  status: Company["status"];
  created_at: string;
  updated_at: string;
};

type CeoIntakeRow = {
  id: string;
  company_id: string;
  body: string;
  status: CeoIntakeStatus;
  created_at: string;
  updated_at: string;
};

type CeoReviewDecisionRow = {
  id: string;
  company_id: string;
  task_id: string;
  department_id: string;
  decision: CeoReviewDecision["decision"];
  return_reason: CeoReviewDecision["returnReason"];
  note: string | null;
  proof_id: string | null;
  proof_type: CeoReviewDecision["proofType"];
  proof_uri: string | null;
  actor: string;
  created_at: string;
};

type DepartmentRow = {
  id: string;
  company_id: string;
  name: string;
  responsibility: string;
  lead_agent_id: string;
  memory_path: string;
};

type ObjectiveRow = {
  id: string;
  company_id: string;
  title: string;
  status: Objective["status"];
  priority: number;
};

type KeyResultRow = {
  id: string;
  objective_id: string;
  title: string;
  metric_name: string;
  target_value: string;
  current_value: string;
  status: KeyResult["status"];
};

type TaskRow = {
  id: string;
  company_id: string;
  department_id: string;
  key_result_id: string | null;
  title: string;
  description: string;
  assignee_agent_id: string;
  required_capabilities: string;
  proof_schema_id: string;
  workspace_path: string | null;
  artifact_workspace_path: string | null;
  status: Task["status"];
  risk_level: Task["riskLevel"];
  position: number;
  latest_failure_reason: AgentFailureReason | null;
  latest_failure_message: string | null;
  latest_execution_profile_name: string | null;
  latest_requested_timeout_ms: number | null;
  latest_effective_timeout_ms: number | null;
  dependency_note: string | null;
  parent_task_id: string | null;
  task_kind: TaskKind;
  source: TaskSource;
};

type ProofRow = {
  id: string;
  task_id: string;
  type: Proof["type"];
  uri: string;
  summary: string;
  verified_at: string | null;
};

type BusinessArtifactRow = {
  id: string;
  company_id: string;
  task_id: string;
  source_proof_id: string | null;
  artifact_type: BusinessArtifact["artifactType"];
  task_type: string;
  payload: string;
  lineage: string;
  validation_status: BusinessArtifact["validationStatus"];
  validation_errors: string;
  review_status: BusinessArtifact["reviewStatus"];
  is_current: number;
  supersedes_artifact_id: string | null;
  created_at: string;
  updated_at: string;
};

type TaskLockRow = {
  task_id: string;
  owner_id: string;
  acquired_at: string;
};

type AgentRunRow = {
  id: string;
  task_id: string;
  agent_id: string;
  status: AgentRun["status"];
  log_path: string;
  started_at: string | null;
  finished_at: string | null;
  execution_profile_name: string | null;
  requested_timeout_ms: number | null;
  effective_timeout_ms: number | null;
  failure_reason: AgentFailureReason | null;
  failure_message: string | null;
};

type ReviewRow = {
  id: string;
  company_id: string;
  summary: string;
  review_path: string;
  created_at: string;
};

type ReplanProposalRow = {
  id: string;
  company_id: string;
  source_task_id: string;
  status: ReplanProposal["status"];
  proposal_source: ReplanProposal["proposalSource"];
  planner_agent_id: string | null;
  planner_prompt_path: string | null;
  planner_failure_reason: string | null;
  planner_failure_message: string | null;
  rationale: string;
  replacement_tasks: string;
  created_at: string;
  confirmed_at: string | null;
};

type TaskDependencyRow = {
  task_id: string;
  depends_on_task_id: string;
  handoff_contract: string | null;
};

type TaskEventRow = {
  id: string;
  company_id: string;
  task_id: string;
  type: TaskEventType;
  message: string;
  created_at: string;
  status: TaskStatus | null;
  failure_reason: AgentFailureReason | null;
  failure_message: string | null;
  execution_profile_name: string | null;
  requested_timeout_ms: number | null;
  effective_timeout_ms: number | null;
  dependency_note: string | null;
  artifact_workspace_path: string | null;
};

type TaskProgressEventRow = {
  id: string;
  company_id: string;
  department_id: string;
  parent_task_id: string;
  subject_task_id: string | null;
  step: TaskProgressStep;
  status: TaskProgressStatus;
  label: string;
  detail: string | null;
  created_at: string;
};

function mapCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    founderVision: row.founder_vision,
    selectedCeoAgentId: row.selected_ceo_agent_id,
    playbookId: row.playbook_id,
    permissionMode: row.permission_mode ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCeoIntake(row: CeoIntakeRow): CeoIntake {
  return {
    id: row.id,
    companyId: row.company_id,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCeoReviewDecision(row: CeoReviewDecisionRow): CeoReviewDecision {
  return {
    id: row.id,
    companyId: row.company_id,
    taskId: row.task_id,
    departmentId: row.department_id,
    decision: row.decision,
    returnReason: row.return_reason,
    note: row.note,
    proofId: row.proof_id,
    proofType: row.proof_type,
    proofUri: row.proof_uri,
    actor: row.actor,
    createdAt: row.created_at,
  };
}

function mapDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    responsibility: row.responsibility,
    leadAgentId: row.lead_agent_id,
    memoryPath: row.memory_path,
  };
}

function mapObjective(row: ObjectiveRow): Objective {
  return {
    id: row.id,
    companyId: row.company_id,
    title: row.title,
    status: row.status,
    priority: row.priority,
  };
}

function mapKeyResult(row: KeyResultRow): KeyResult {
  return {
    id: row.id,
    objectiveId: row.objective_id,
    title: row.title,
    metricName: row.metric_name,
    targetValue: row.target_value,
    currentValue: row.current_value,
    status: row.status,
  };
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    companyId: row.company_id,
    departmentId: row.department_id,
    keyResultId: row.key_result_id,
    title: row.title,
    description: row.description,
    assigneeAgentId: row.assignee_agent_id,
    requiredCapabilities: JSON.parse(row.required_capabilities) as string[],
    proofSchemaId: row.proof_schema_id,
    workspacePath: row.workspace_path,
    artifactWorkspacePath: row.artifact_workspace_path,
    status: row.status,
    riskLevel: row.risk_level,
    position: row.position,
    latestFailureReason: row.latest_failure_reason,
    latestFailureMessage: row.latest_failure_message,
    latestExecutionProfileName: row.latest_execution_profile_name,
    latestRequestedTimeoutMs: row.latest_requested_timeout_ms,
    latestEffectiveTimeoutMs: row.latest_effective_timeout_ms,
    dependencyNote: row.dependency_note,
    parentTaskId: row.parent_task_id,
    taskKind: row.task_kind,
    source: row.source,
  };
}

function mapProof(row: ProofRow): Proof {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type,
    uri: row.uri,
    summary: row.summary,
    verifiedAt: row.verified_at,
  };
}

function mapBusinessArtifact(row: BusinessArtifactRow): BusinessArtifact {
  return {
    id: row.id,
    companyId: row.company_id,
    taskId: row.task_id,
    sourceProofId: row.source_proof_id,
    artifactType: row.artifact_type,
    taskType: row.task_type,
    payload: JSON.parse(row.payload) as unknown,
    lineage: JSON.parse(row.lineage) as unknown,
    validationStatus: row.validation_status,
    validationErrors: JSON.parse(row.validation_errors) as unknown[],
    reviewStatus: row.review_status,
    isCurrent: row.is_current === 1,
    supersedesArtifactId: row.supersedes_artifact_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    taskId: row.task_id,
    agentId: row.agent_id,
    status: row.status,
    logPath: row.log_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    executionProfileName: row.execution_profile_name,
    requestedTimeoutMs: row.requested_timeout_ms,
    effectiveTimeoutMs: row.effective_timeout_ms,
    failureReason: row.failure_reason,
    failureMessage: row.failure_message,
  };
}

function mapReview(row: ReviewRow): ReviewRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    summary: row.summary,
    reviewPath: row.review_path,
    createdAt: row.created_at,
  };
}

function mapReplanProposal(row: ReplanProposalRow): ReplanProposal {
  return {
    id: row.id,
    companyId: row.company_id,
    sourceTaskId: row.source_task_id,
    status: row.status,
    proposalSource: row.proposal_source,
    plannerAgentId: row.planner_agent_id,
    plannerPromptPath: row.planner_prompt_path,
    plannerFailureReason: row.planner_failure_reason,
    plannerFailureMessage: row.planner_failure_message,
    rationale: row.rationale,
    replacementTasks: JSON.parse(row.replacement_tasks) as ReplanProposal["replacementTasks"],
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

function mapTaskDependency(row: TaskDependencyRow): TaskDependency {
  return {
    taskId: row.task_id,
    dependsOnTaskId: row.depends_on_task_id,
    ...(row.handoff_contract ? { handoffContract: row.handoff_contract } : {}),
  };
}

function mapTaskEvent(row: TaskEventRow): TaskEvent {
  return {
    id: row.id,
    companyId: row.company_id,
    taskId: row.task_id,
    type: row.type,
    message: row.message,
    createdAt: row.created_at,
    status: row.status,
    failureReason: row.failure_reason,
    failureMessage: row.failure_message,
    executionProfileName: row.execution_profile_name,
    requestedTimeoutMs: row.requested_timeout_ms,
    effectiveTimeoutMs: row.effective_timeout_ms,
    dependencyNote: row.dependency_note,
    artifactWorkspacePath: row.artifact_workspace_path,
  };
}

function mapTaskProgressEvent(row: TaskProgressEventRow): TaskProgressEvent {
  return {
    id: row.id,
    companyId: row.company_id,
    departmentId: row.department_id,
    parentTaskId: row.parent_task_id,
    subjectTaskId: row.subject_task_id,
    step: row.step,
    status: row.status,
    label: row.label,
    detail: row.detail,
    createdAt: row.created_at,
  };
}
