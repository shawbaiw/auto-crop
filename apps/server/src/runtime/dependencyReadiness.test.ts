import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Company, Department, KeyResult, Objective, Proof, Task } from "@auto-crop/core";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { resolveDependencyReadiness } from "./dependencyReadiness";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveDependencyReadiness", () => {
  it.each(["queued", "running", "retrying", "waiting_dependency"] as const)(
    "waits while an upstream dependency is %s",
    (status) => {
      const { repositories, client } = createFixture([
        createTaskRecord("task_1", status),
        createTaskRecord("task_2", "queued"),
      ]);
      repositories.createTaskDependency({ taskId: "task_2", dependsOnTaskId: "task_1" });

      const readiness = resolveDependencyReadiness(repositories, repositories.getTask("task_2")!);

      expect(readiness).toEqual({
        kind: "waiting",
        note: `Waiting for dependency deliverable: Task task_1 (${status}).`,
      });
      client.close();
    },
  );

  it("blocks when an upstream dependency failed", () => {
    const { repositories, client } = createFixture([
      createTaskRecord("task_1", "failed"),
      createTaskRecord("task_2", "queued"),
    ]);
    repositories.createTaskDependency({
      taskId: "task_2",
      dependsOnTaskId: "task_1",
      handoffContract: "Consume the product brief before drafting launch copy.",
    });

    const readiness = resolveDependencyReadiness(repositories, repositories.getTask("task_2")!);

    expect(readiness).toMatchObject({
      kind: "blocked",
      reason: "dependency_failed",
      note: "Blocked by failed dependency: Task task_1.",
    });
    client.close();
  });

  it("blocks for replanning when an upstream dependency needs replan", () => {
    const { repositories, client } = createFixture([
      createTaskRecord("task_1", "needs_replan"),
      createTaskRecord("task_2", "queued"),
    ]);
    repositories.createTaskDependency({
      taskId: "task_2",
      dependsOnTaskId: "task_1",
      handoffContract: "Consume the product brief before drafting launch copy.",
    });

    const readiness = resolveDependencyReadiness(repositories, repositories.getTask("task_2")!);

    expect(readiness).toMatchObject({
      kind: "blocked",
      reason: "needs_replan",
      note: "Waiting for dependency to be replanned: Task task_1.",
    });
    client.close();
  });

  it("blocks when an upstream dependency is review-ready but has no consumable proof", () => {
    const { repositories, client } = createFixture([
      createTaskRecord("task_1", "review"),
      createTaskRecord("task_2", "queued"),
    ]);
    repositories.createTaskDependency({
      taskId: "task_2",
      dependsOnTaskId: "task_1",
      handoffContract: "Consume the product brief before drafting launch copy.",
    });

    const readiness = resolveDependencyReadiness(repositories, repositories.getTask("task_2")!);

    expect(readiness).toMatchObject({
      kind: "missing_deliverable",
      note: "Missing consumable proof from dependency: Task task_1.",
    });
    client.close();
  });

  it("returns handoffs when every upstream dependency has consumable proof", () => {
    const { repositories, client } = createFixture([
      { ...createTaskRecord("task_1", "review"), artifactWorkspacePath: "/tmp/artifact-workspace" },
      createTaskRecord("task_2", "queued"),
    ]);
    repositories.createTaskDependency({
      taskId: "task_2",
      dependsOnTaskId: "task_1",
      handoffContract: "Consume the product brief before drafting launch copy.",
    });
    repositories.appendProof({
      id: "proof_1",
      taskId: "task_1",
      type: "file",
      uri: "/tmp/artifact-workspace/product-brief.md",
      summary: "File proof: product-brief.md",
      verifiedAt: null,
    } satisfies Proof);

    const readiness = resolveDependencyReadiness(repositories, repositories.getTask("task_2")!);

    expect(readiness).toEqual({
      kind: "ready",
      handoffs: [
        {
          upstreamTaskId: "task_1",
          upstreamTaskTitle: "Task task_1",
          proofId: "proof_1",
          proofType: "file",
          uri: "/tmp/artifact-workspace/product-brief.md",
          summary: "File proof: product-brief.md",
          artifactWorkspacePath: "/tmp/artifact-workspace",
          handoffContract: "Consume the product brief before drafting launch copy.",
        },
      ],
    });
    client.close();
  });
});

function createFixture(tasks: Task[]) {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-readiness-"));
  createdDirs.push(projectRoot);
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);

  repositories.createCompany(createCompanyRecord());
  repositories.createDepartment(createDepartmentRecord());
  repositories.createObjective(createObjectiveRecord());
  repositories.createKeyResult(createKeyResultRecord());
  for (const task of tasks) {
    repositories.createTask(task);
  }

  return { repositories, client };
}

function createCompanyRecord(): Company {
  return {
    id: "company_1",
    name: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    selectedCeoAgentId: "codex",
    playbookId: "ai-saas",
    status: "active",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };
}

function createDepartmentRecord(): Department {
  return {
    id: "department_1",
    companyId: "company_1",
    name: "Engineering",
    responsibility: "Build and validate the product.",
    leadAgentId: "codex",
    memoryPath: ".auto-crop/companies/company_1/departments/engineering/Memory.md",
  };
}

function createObjectiveRecord(): Objective {
  return {
    id: "objective_1",
    companyId: "company_1",
    title: "Validate the first wedge",
    status: "active",
    priority: 1,
  };
}

function createKeyResultRecord(): KeyResult {
  return {
    id: "key_result_1",
    objectiveId: "objective_1",
    title: "Ship proof-backed prototype",
    metricName: "prototype_status",
    targetValue: "local_url",
    currentValue: "not_started",
    status: "active",
  };
}

function createTaskRecord(id: string, status: Task["status"]): Task {
  const numericSuffix = Number(id.split("_").at(-1));

  return {
    id,
    companyId: "company_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    title: `Task ${id}`,
    description: "Run mock work.",
    assigneeAgentId: "mock-worker",
    requiredCapabilities: ["code"],
    proofSchemaId: "test-output",
    workspacePath: null,
    status,
    riskLevel: "low",
    position: Number.isFinite(numericSuffix) ? numericSuffix - 1 : 0,
  };
}
