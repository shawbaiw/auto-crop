import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Company, Department, KeyResult, Objective, Proof, Task } from "@auto-crop/core";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { routeWorkerFailure } from "./failure";
import { runCompanyReview } from "./review";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("routeWorkerFailure", () => {
  it("routes worker failure logs to the department Lead and creates a fix task", () => {
    const { repositories, task, logPath } = createReviewFixture();

    const result = routeWorkerFailure({
      repositories,
      failedTask: task,
      logPath,
      decision: "create_fix_task",
      createId: createSequentialIdFactory(),
    });

    expect(result.kind).toBe("fix_task_created");
    expect(repositories.getTask("task_1")?.status).toBe("failed");
    expect(repositories.getTask("task_1_fix_1")?.status).toBe("queued");
    expect(repositories.getTask("task_1_fix_1")?.assigneeAgentId).toBe("codex");
  });

  it("can mark failed work blocked for founder input", () => {
    const { repositories, task, logPath } = createReviewFixture();

    const result = routeWorkerFailure({
      repositories,
      failedTask: task,
      logPath,
      decision: "mark_blocked",
      createId: createSequentialIdFactory(),
    });

    expect(result.kind).toBe("blocked");
    expect(repositories.getTask("task_1")?.status).toBe("blocked");
  });

  it("can escalate strategic failures to CEO Office", () => {
    const { repositories, task, logPath } = createReviewFixture();

    const result = routeWorkerFailure({
      repositories,
      failedTask: task,
      logPath,
      decision: "escalate_to_ceo",
      createId: createSequentialIdFactory(),
    });

    expect(result.kind).toBe("escalated_to_ceo");
    expect(repositories.getTask("task_1")?.status).toBe("review");
  });
});

describe("runCompanyReview", () => {
  it("reviews proof against key results, updates priority state, and writes review markdown", () => {
    const { projectRoot, repositories, task } = createReviewFixture();
    const proof: Proof = {
      id: "proof_1",
      taskId: task.id,
      type: "command_output",
      uri: "agent.log",
      summary: "Tests passed.",
      verifiedAt: null,
    };
    repositories.updateTaskStatus(task.id, "review");
    repositories.appendProof(proof);

    const result = runCompanyReview({
      projectRoot,
      companyId: "company_1",
      repositories,
      createId: createSequentialIdFactory(),
      now: () => new Date("2026-08-17T00:00:00.000Z"),
    });

    expect(result.completedTasks).toEqual(["task_1"]);
    expect(result.missingProofTasks).toEqual([]);
    expect(repositories.getTask("task_1")?.status).toBe("complete");
    expect(repositories.listKeyResults("company_1")[0]?.currentValue).toBe("proof_received");
    expect(repositories.listKeyResults("company_1")[0]?.status).toBe("met");
    expect(existsSync(result.reviewPath)).toBe(true);
    expect(readFileSync(result.reviewPath, "utf8")).toContain("Tests passed.");
    expect(repositories.listReviews("company_1")).toHaveLength(1);
  });

  it("keeps missing-proof tasks in review and raises objective priority", () => {
    const { projectRoot, repositories, task } = createReviewFixture();
    repositories.updateTaskStatus(task.id, "review");

    const result = runCompanyReview({
      projectRoot,
      companyId: "company_1",
      repositories,
      createId: createSequentialIdFactory(),
      now: () => new Date("2026-08-17T00:00:00.000Z"),
    });

    expect(result.completedTasks).toEqual([]);
    expect(result.missingProofTasks).toEqual(["task_1"]);
    expect(repositories.getTask("task_1")?.status).toBe("review");
    expect(repositories.listObjectives("company_1")[0]?.priority).toBe(0);
  });
});

function createReviewFixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-review-"));
  createdDirs.push(projectRoot);
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);
  const logsDir = join(projectRoot, ".auto-crop", "companies", "company_1", "logs");
  const logPath = join(logsDir, "task_1.log");
  const company: Company = {
    id: "company_1",
    name: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    selectedCeoAgentId: "codex",
    playbookId: "ai-saas",
    status: "active",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };
  const department: Department = {
    id: "department_1",
    companyId: "company_1",
    name: "Engineering",
    responsibility: "Build and validate the product.",
    leadAgentId: "codex",
    memoryPath: join(projectRoot, ".auto-crop", "companies", "company_1", "departments", "engineering", "Memory.md"),
  };
  const objective: Objective = {
    id: "objective_1",
    companyId: "company_1",
    title: "Validate first wedge",
    status: "active",
    priority: 1,
  };
  const keyResult: KeyResult = {
    id: "key_result_1",
    objectiveId: "objective_1",
    title: "Collect proof",
    metricName: "proof_status",
    targetValue: "proof_received",
    currentValue: "not_started",
    status: "active",
  };
  const task: Task = {
    id: "task_1",
    companyId: "company_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    title: "Run validation",
    description: "Run validation and collect proof.",
    assigneeAgentId: "codex",
    requiredCapabilities: ["code", "test"],
    proofSchemaId: "test-output",
    workspacePath: join(projectRoot, ".auto-crop", "workspaces", "task_1"),
    status: "failed",
    riskLevel: "low",
    position: 0,
  };

  repositories.createCompany(company);
  repositories.createDepartment(department);
  repositories.createObjective(objective);
  repositories.createKeyResult(keyResult);
  repositories.createTask(task);
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(logPath, "Error: test command failed\n", { encoding: "utf8", flag: "w" });

  return { projectRoot, repositories, task, logPath, client };
}

function createSequentialIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}
