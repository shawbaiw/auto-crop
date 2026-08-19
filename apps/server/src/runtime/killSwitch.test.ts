import { describe, expect, it } from "vitest";
import type { Company, Department, KeyResult, Objective, Task } from "@auto-crop/core";
import { createMockAgentAdapter } from "../adapters/mockAgent";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { triggerKillSwitch } from "./killSwitch";
import { runSchedulerOnce } from "./scheduler";

describe("triggerKillSwitch", () => {
  it("sets global pause, cancels active runs, releases locks, and moves company to review", () => {
    const { client, repositories } = createKillSwitchFixture();
    const cancelled: string[] = [];
    repositories.acquireTaskLock("task_1", "worker_a", "2026-08-17T00:00:00.000Z");
    repositories.updateTaskStatus("task_1", "running");
    repositories.createAgentRun({
      id: "agent_run_1",
      taskId: "task_1",
      agentId: "codex",
      status: "running",
      logPath: ".auto-crop/companies/company_1/logs/task_1.log",
      startedAt: "2026-08-17T00:00:00.000Z",
      finishedAt: null,
    });

    const result = triggerKillSwitch({
      companyId: "company_1",
      repositories,
      now: () => new Date("2026-08-17T00:00:10.000Z"),
      cancelActiveRun: (taskId) => cancelled.push(taskId),
    });

    expect(result.cancelledTasks).toEqual(["task_1"]);
    expect(result.releasedLocks).toEqual(["task_1"]);
    expect(cancelled).toEqual(["task_1"]);
    expect(repositories.isGlobalPaused()).toBe(true);
    expect(repositories.getCompany("company_1")?.status).toBe("review");
    expect(repositories.getTask("task_1")?.status).toBe("cancelled");
    expect(repositories.listTaskLocks()).toEqual([]);

    client.close();
  });

  it("makes the scheduler stop claiming new tasks while paused", async () => {
    const { client, repositories } = createKillSwitchFixture();
    repositories.setGlobalPaused(true);

    const result = await runSchedulerOnce({
      projectRoot: ".",
      repositories,
      adapters: [
        createMockAgentAdapter({
          id: "codex",
          name: "Codex",
          capabilities: ["code"],
        }),
      ],
      workerId: "worker_a",
      maxTasks: 1,
      approvalRequired: () => false,
      proofCollector: () => [],
      emit: () => undefined,
    });

    expect(result.started).toEqual([]);
    expect(repositories.getTask("task_1")?.status).toBe("queued");

    client.close();
  });
});

function createKillSwitchFixture() {
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);
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
    responsibility: "Build and validate.",
    leadAgentId: "codex",
    memoryPath: ".auto-crop/companies/company_1/departments/engineering/Memory.md",
  };
  const objective: Objective = {
    id: "objective_1",
    companyId: "company_1",
    title: "Validate",
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
    description: "Run validation.",
    assigneeAgentId: "codex",
    requiredCapabilities: ["code"],
    proofSchemaId: "test-output",
    workspacePath: ".auto-crop/workspaces/task_1",
    status: "queued",
    riskLevel: "low",
    position: 0,
  };

  repositories.createCompany(company);
  repositories.createDepartment(department);
  repositories.createObjective(objective);
  repositories.createKeyResult(keyResult);
  repositories.createTask(task);

  return { client, repositories };
}
