import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Company, Department, KeyResult, Objective, ProofSchema, Task } from "@auto-crop/core";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { refreshTaskDependencyState } from "./taskRefresh";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("refreshTaskDependencyState proof recovery", () => {
  it("recovers controlled repo-diff output from failed no-proof tasks and submits them to review", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-refresh-proof-"));
    createdDirs.push(workspacePath);
    writeFileSync(join(workspacePath, "prototype-audit-trail.patch"), "diff --git a/app/page.tsx b/app/page.tsx\n", "utf8");
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        workspacePath,
        status: "failed",
        proofSchemaId: "repo-diff",
      },
    ]);
    fixture.repositories.updateTaskExecutionSummary("task_1", {
      latestFailureReason: "no_proof",
      latestFailureMessage: "Task failed: Record implementation changes / no_proof.",
    });

    const result = refreshTaskDependencyState({
      repositories: fixture.repositories,
      taskId: "task_1",
      proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.task.status).toBe("review");
    expect(result.recovery).toEqual({
      status: "recovered",
      message: "Found checkable proof and submitted it to CEO Office for review.",
    });
    expect(result.proof).toHaveLength(1);
    expect(fixture.repositories.listProofsForTask("task_1")[0]).toMatchObject({
      type: "diff",
      summary: "Diff proof recovered from prototype-audit-trail.patch.",
    });
    expect(result.event).toMatchObject({
      type: "proof_recovered",
      status: "review",
      message: "Proof recovered: Record implementation changes submitted to CEO Office for review.",
    });
    expect(result.progressEvent).toMatchObject({
      step: "awaiting_review",
      status: "current",
      label: "Found checkable proof and submitted it to CEO Office for review.",
    });
  });

  it("does not recover unrelated failed tasks", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-refresh-proof-"));
    createdDirs.push(workspacePath);
    writeFileSync(join(workspacePath, "prototype-audit-trail.patch"), "diff --git a/app/page.tsx b/app/page.tsx\n", "utf8");
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        workspacePath,
        status: "failed",
        proofSchemaId: "repo-diff",
      },
    ]);
    fixture.repositories.updateTaskExecutionSummary("task_1", {
      latestFailureReason: "timeout",
      latestFailureMessage: "Task failed: Record implementation changes / timeout.",
    });

    const result = refreshTaskDependencyState({
      repositories: fixture.repositories,
      taskId: "task_1",
      proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.task.status).toBe("queued");
    expect(result.recovery).toEqual({
      status: "not_applicable",
      message: "Proof recovery does not apply to this task.",
    });
    expect(fixture.repositories.listProofsForTask("task_1")).toEqual([]);
  });
});

function createFixture(tasks: Task[]) {
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
    responsibility: "Build prototypes.",
    leadAgentId: "codex",
    memoryPath: ".auto-crop/companies/company_1/departments/engineering/memory.md",
  };
}

function createObjectiveRecord(): Objective {
  return {
    id: "objective_1",
    companyId: "company_1",
    title: "Validate first wedge",
    status: "active",
    priority: 1,
  };
}

function createKeyResultRecord(): KeyResult {
  return {
    id: "key_result_1",
    objectiveId: "objective_1",
    title: "Ship proof-backed prototype",
    metricName: "proof_status",
    targetValue: "proof_received",
    currentValue: "not_started",
    status: "active",
  };
}

function createTaskRecord(): Task {
  return {
    id: "task_1",
    companyId: "company_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    title: "Record implementation changes",
    description: "Record implementation changes.",
    assigneeAgentId: "codex",
    requiredCapabilities: ["code"],
    proofSchemaId: "repo-diff",
    workspacePath: ".auto-crop/workspaces/task_1",
    status: "queued",
    riskLevel: "medium",
    position: 0,
  };
}

function createSequentialIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}
