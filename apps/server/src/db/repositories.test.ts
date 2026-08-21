import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseClient } from "./client";
import { migrate } from "./schema";
import { createRepositories } from "./repositories";
import type { Company, Department, KeyResult, Objective, Proof, ReplanProposal, Task } from "@auto-crop/core";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("repositories", () => {
  it("persists task lifecycle transitions and proof", () => {
    const { repos, close } = openTestRepositories();
    const records = createRecords();

    repos.createCompany(records.company);
    repos.createDepartment(records.department);
    repos.createObjective(records.objective);
    repos.createKeyResult(records.keyResult);
    repos.createTask(records.task);

    expect(repos.fetchQueuedTasks(10).map((task) => task.id)).toEqual(["task_1"]);

    repos.updateTaskStatus("task_1", "running");
    expect(repos.getTask("task_1")?.status).toBe("running");

    repos.updateTaskStatus("task_1", "review");
    repos.appendProof(records.proof);
    expect(repos.listProofsForTask("task_1")).toEqual([records.proof]);

    repos.updateTaskStatus("task_1", "complete");
    expect(repos.getTask("task_1")?.status).toBe("complete");
    expect(repos.fetchQueuedTasks(10)).toEqual([]);

    close();
  });

  it("recovers queued tasks after reopening the same SQLite database", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-crop-db-"));
    createdDirs.push(dir);
    const databasePath = join(dir, "state.sqlite");
    const records = createRecords();

    {
      const client = createDatabaseClient(databasePath);
      migrate(client);
      const repos = createRepositories(client);
      repos.createCompany(records.company);
      repos.createDepartment(records.department);
      repos.createObjective(records.objective);
      repos.createKeyResult(records.keyResult);
      repos.createTask(records.task);
      client.close();
    }

    const reopenedClient = createDatabaseClient(databasePath);
    migrate(reopenedClient);
    const reopenedRepos = createRepositories(reopenedClient);

    expect(reopenedRepos.fetchQueuedTasks(10)).toEqual([expect.objectContaining(records.task)]);

    reopenedClient.close();
  });

  it("orders queued and company tasks by explicit position", () => {
    const { repos, close } = openTestRepositories();
    const records = createRecords();
    const firstTask = { ...records.task, id: "task_z", title: "First queued task", position: 0 };
    const secondTask = { ...records.task, id: "task_a", title: "Second queued task", position: 1 };

    repos.createCompany(records.company);
    repos.createDepartment(records.department);
    repos.createObjective(records.objective);
    repos.createKeyResult(records.keyResult);
    repos.createTask(secondTask);
    repos.createTask(firstTask);

    expect(repos.fetchQueuedTasks(10).map((task) => task.id)).toEqual(["task_z", "task_a"]);
    expect(repos.listTasksForCompany("company_1").map((task) => task.id)).toEqual(["task_z", "task_a"]);
    expect(repos.getNextTaskPosition("company_1")).toBe(2);

    close();
  });

  it("backfills explicit task positions when migrating an existing database", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-crop-db-"));
    createdDirs.push(dir);
    const databasePath = join(dir, "state.sqlite");
    const legacyClient = createDatabaseClient(databasePath);

    legacyClient.exec(`
      CREATE TABLE companies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        founder_vision TEXT NOT NULL,
        selected_ceo_agent_id TEXT NOT NULL,
        playbook_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE departments (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        responsibility TEXT NOT NULL,
        lead_agent_id TEXT NOT NULL,
        memory_path TEXT NOT NULL
      );

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        key_result_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        assignee_agent_id TEXT NOT NULL,
        required_capabilities TEXT NOT NULL,
        proof_schema_id TEXT NOT NULL,
        workspace_path TEXT,
        status TEXT NOT NULL,
        risk_level TEXT NOT NULL
      );
    `);
    legacyClient
      .prepare(
        `INSERT INTO companies (
          id, name, founder_vision, selected_ceo_agent_id, playbook_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "company_1",
        "Pricing Page Studio",
        "Build an AI SaaS for pricing pages.",
        "codex",
        "ai-saas",
        "active",
        "2026-08-17T00:00:00.000Z",
        "2026-08-17T00:00:00.000Z",
      );
    legacyClient
      .prepare(
        `INSERT INTO departments (
          id, company_id, name, responsibility, lead_agent_id, memory_path
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "department_engineering",
        "company_1",
        "Engineering",
        "Build prototypes.",
        "codex",
        ".auto-crop/companies/company_1/departments/engineering/Memory.md",
      );
    insertLegacyTask(legacyClient, "task_z", "First legacy task");
    insertLegacyTask(legacyClient, "task_a", "Second legacy task");
    legacyClient.close();

    const migratedClient = createDatabaseClient(databasePath);
    migrate(migratedClient);
    const repos = createRepositories(migratedClient);

    expect(repos.listTasksForCompany("company_1").map((task) => [task.id, task.position])).toEqual([
      ["task_z", 0],
      ["task_a", 1],
    ]);

    migratedClient.close();
  });

  it("persists replan proposals and rewires dependency consumers", () => {
    const { repos, close } = openTestRepositories();
    const records = createRecords();
    const blockedConsumer = {
      ...records.task,
      id: "task_2",
      title: "Validate replacement",
      proofSchemaId: "test-output",
      position: 1,
    };
    const replacement = {
      ...records.task,
      id: "task_3",
      title: "Replacement final task",
      position: 2,
    };
    const proposal: ReplanProposal = {
      id: "replan_proposal_1",
      companyId: records.company.id,
      sourceTaskId: records.task.id,
      status: "proposed",
      rationale: "Original task exceeded long budget.",
      replacementTasks: [
        {
          title: "Research smaller scope",
          description: "Research the smallest proof-producing slice.",
          proofSchemaId: "research-report",
          requiredCapabilities: ["research", "writing"],
          riskLevel: "low",
        },
      ],
      createdAt: "2026-08-17T00:00:00.000Z",
      confirmedAt: null,
    };

    repos.createCompany(records.company);
    repos.createDepartment(records.department);
    repos.createObjective(records.objective);
    repos.createKeyResult(records.keyResult);
    repos.createTask({ ...records.task, status: "needs_replan" });
    repos.createTask(blockedConsumer);
    repos.createTask(replacement);
    repos.createTaskDependency({ taskId: blockedConsumer.id, dependsOnTaskId: records.task.id });
    repos.createReplanProposal(proposal);

    expect(repos.listReplanProposalsForCompany(records.company.id)).toEqual([proposal]);

    repos.replaceDependencyConsumers(records.task.id, replacement.id);

    expect(repos.listTaskDependencies(blockedConsumer.id)).toEqual([
      { taskId: blockedConsumer.id, dependsOnTaskId: replacement.id },
    ]);

    repos.updateReplanProposalStatus(proposal.id, "confirmed", "2026-08-17T00:01:00.000Z");
    expect(repos.listReplanProposalsForCompany(records.company.id)[0]).toMatchObject({
      status: "confirmed",
      confirmedAt: "2026-08-17T00:01:00.000Z",
    });

    close();
  });
});

function openTestRepositories() {
  const client = createDatabaseClient(":memory:");
  migrate(client);

  return {
    repos: createRepositories(client),
    close: () => client.close(),
  };
}

function createRecords(): {
  company: Company;
  department: Department;
  objective: Objective;
  keyResult: KeyResult;
  task: Task;
  proof: Proof;
} {
  return {
    company: {
      id: "company_1",
      name: "Pricing Page Studio",
      founderVision: "Build an AI SaaS for pricing pages.",
      selectedCeoAgentId: "codex",
      playbookId: "ai-saas",
      status: "active",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    },
    department: {
      id: "department_engineering",
      companyId: "company_1",
      name: "Engineering",
      responsibility: "Build prototypes and collect engineering proof.",
      leadAgentId: "codex",
      memoryPath: ".auto-crop/companies/company_1/departments/engineering/Memory.md",
    },
    objective: {
      id: "objective_1",
      companyId: "company_1",
      title: "Validate the first AI SaaS wedge",
      status: "active",
      priority: 1,
    },
    keyResult: {
      id: "key_result_1",
      objectiveId: "objective_1",
      title: "Ship a proof-backed landing page prototype",
      metricName: "prototype_status",
      targetValue: "local_url_or_deployment_url",
      currentValue: "not_started",
      status: "active",
    },
    task: {
      id: "task_1",
      companyId: "company_1",
      departmentId: "department_engineering",
      keyResultId: "key_result_1",
      title: "Create the first landing page prototype",
      description: "Build a pricing-page-focused landing page prototype.",
      assigneeAgentId: "codex",
      requiredCapabilities: ["code", "frontend"],
      proofSchemaId: "landing-page-proof",
      workspacePath: ".auto-crop/workspaces/task_1",
      status: "queued",
      riskLevel: "medium",
      position: 0,
    },
    proof: {
      id: "proof_1",
      taskId: "task_1",
      type: "file",
      uri: ".auto-crop/workspaces/task_1/index.html",
      summary: "Landing page prototype file created.",
      verifiedAt: null,
    },
  };
}

function insertLegacyTask(client: ReturnType<typeof createDatabaseClient>, id: string, title: string): void {
  client
    .prepare(
      `INSERT INTO tasks (
        id, company_id, department_id, key_result_id, title, description,
        assignee_agent_id, required_capabilities, proof_schema_id, workspace_path, status, risk_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      "company_1",
      "department_engineering",
      null,
      title,
      "Run legacy work.",
      "codex",
      JSON.stringify(["code"]),
      "test-output",
      null,
      "queued",
      "low",
    );
}
