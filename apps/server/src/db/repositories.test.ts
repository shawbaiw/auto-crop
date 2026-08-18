import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseClient } from "./client";
import { migrate } from "./schema";
import { createRepositories } from "./repositories";
import type { Company, Department, KeyResult, Objective, Proof, Task } from "@auto-crop/core";

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

    expect(reopenedRepos.fetchQueuedTasks(10)).toEqual([records.task]);

    reopenedClient.close();
  });

  it("only returns dependency-ready queued tasks as runnable", () => {
    const { repos, close } = openTestRepositories();
    const records = createRecords();
    const downstreamTask: Task = {
      ...records.task,
      id: "task_2",
      title: "Run local validation for the prototype",
      proofSchemaId: "test-output",
    };

    repos.createCompany(records.company);
    repos.createDepartment(records.department);
    repos.createObjective(records.objective);
    repos.createKeyResult(records.keyResult);
    repos.createTask(records.task);
    repos.createTask(downstreamTask);
    repos.createTaskDependency({ taskId: downstreamTask.id, dependsOnTaskId: records.task.id });

    expect(repos.fetchQueuedTasks(10).map((task) => task.id)).toEqual(["task_1", "task_2"]);
    expect(repos.fetchRunnableQueuedTasks(10).map((task) => task.id)).toEqual(["task_1"]);

    repos.updateTaskStatus(records.task.id, "review");
    expect(repos.fetchRunnableQueuedTasks(10).map((task) => task.id)).toEqual([]);

    repos.appendProof(records.proof);
    expect(repos.fetchRunnableQueuedTasks(10).map((task) => task.id)).toEqual(["task_2"]);
    expect(repos.listTaskDependencies(downstreamTask.id).map((task) => task.id)).toEqual(["task_1"]);

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
