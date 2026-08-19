import type {
  AgentRun,
  Approval,
  Company,
  Department,
  KeyResult,
  Objective,
  Proof,
  Task,
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
            id, name, founder_vision, selected_ceo_agent_id, playbook_id, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          company.id,
          company.name,
          company.founderVision,
          company.selectedCeoAgentId,
          company.playbookId,
          company.status,
          company.createdAt,
          company.updatedAt,
        );
    },

    getCompany(id: string): Company | null {
      const row = database.prepare("SELECT * FROM companies WHERE id = ?").get(id);
      return row ? mapCompany(row as CompanyRow) : null;
    },

    updateCompanyStatus(id: string, status: Company["status"], updatedAt: string): void {
      database
        .prepare("UPDATE companies SET status = ?, updated_at = ? WHERE id = ?")
        .run(status, updatedAt, id);
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
            assignee_agent_id, required_capabilities, proof_schema_id, workspace_path, status, risk_level,
            position
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          task.status,
          task.riskLevel,
          task.position,
        );
    },

    getTask(id: string): Task | null {
      const row = database.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
      return row ? mapTask(row as TaskRow) : null;
    },

    updateTaskStatus(id: string, status: TaskStatus): void {
      database.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id);
    },

    updateTaskWorkspacePath(id: string, workspacePath: string): void {
      database.prepare("UPDATE tasks SET workspace_path = ? WHERE id = ?").run(workspacePath, id);
    },

    fetchQueuedTasks(limit: number): Task[] {
      const rows = database
        .prepare(
          `SELECT tasks.*
           FROM tasks
           INNER JOIN companies ON companies.id = tasks.company_id
           WHERE tasks.status = 'queued'
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
            id, task_id, agent_id, status, log_path, started_at, finished_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          agentRun.id,
          agentRun.taskId,
          agentRun.agentId,
          agentRun.status,
          agentRun.logPath,
          agentRun.startedAt,
          agentRun.finishedAt,
        );
    },

    updateAgentRunStatus(
      id: string,
      status: AgentRun["status"],
      finishedAt: string | null,
    ): void {
      database
        .prepare("UPDATE agent_runs SET status = ?, finished_at = ? WHERE id = ?")
        .run(status, finishedAt, id);
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
  };
}

type CompanyRow = {
  id: string;
  name: string;
  founder_vision: string;
  selected_ceo_agent_id: string;
  playbook_id: string;
  status: Company["status"];
  created_at: string;
  updated_at: string;
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
  status: Task["status"];
  risk_level: Task["riskLevel"];
  position: number;
};

type ProofRow = {
  id: string;
  task_id: string;
  type: Proof["type"];
  uri: string;
  summary: string;
  verified_at: string | null;
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
};

type ReviewRow = {
  id: string;
  company_id: string;
  summary: string;
  review_path: string;
  created_at: string;
};

function mapCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    founderVision: row.founder_vision,
    selectedCeoAgentId: row.selected_ceo_agent_id,
    playbookId: row.playbook_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    status: row.status,
    riskLevel: row.risk_level,
    position: row.position,
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

function mapAgentRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    taskId: row.task_id,
    agentId: row.agent_id,
    status: row.status,
    logPath: row.log_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
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
