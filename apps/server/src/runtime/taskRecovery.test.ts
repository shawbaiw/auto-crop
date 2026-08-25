import { describe, expect, it } from "vitest";
import type { AgentRun, Company, Department, KeyResult, Objective, Task } from "@auto-crop/core";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { reconcileStaleRunningTasks, recoverTask } from "./taskRecovery";

describe("task recovery", () => {
  it("marks stale running tasks as timed out and clears their lock", () => {
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        status: "running",
      },
    ]);
    fixture.repositories.acquireTaskLock("task_1", "worker_1", "2026-08-25T00:00:00.000Z");
    fixture.repositories.createAgentRun(createAgentRunRecord());

    const result = reconcileStaleRunningTasks({
      repositories: fixture.repositories,
      companyId: "company_1",
      now: () => new Date("2026-08-25T00:03:01.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.reconciledTaskIds).toEqual(["task_1"]);
    expect(fixture.repositories.getTask("task_1")).toMatchObject({
      status: "failed",
      latestFailureReason: "timeout",
      latestFailureMessage: "Task failed: Record implementation changes / timeout after 3m.",
    });
    expect(fixture.repositories.listRunningAgentRuns("company_1")).toEqual([]);
    expect(fixture.repositories.listTaskLocks()).toEqual([]);
    expect(fixture.repositories.listTaskEventsForCompany("company_1")).toContainEqual(
      expect.objectContaining({
        type: "task_failed",
        taskId: "task_1",
        status: "failed",
        failureReason: "timeout",
      }),
    );
    expect(fixture.repositories.listTaskProgressEventsForCompany("company_1")).toContainEqual(
      expect.objectContaining({
        parentTaskId: "task_1",
        subjectTaskId: "task_1",
        step: "blocked",
        status: "blocked",
        label: "Task timed out and is waiting for recovery.",
      }),
    );
  });

  it("requeues a failed timeout task when there is no Partial Output", () => {
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        status: "failed",
        latestFailureReason: "timeout",
        latestFailureMessage: "Task failed: Record implementation changes / timeout after 3m.",
      },
    ]);

    const result = recoverTask({
      repositories: fixture.repositories,
      taskId: "task_1",
      proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
      now: () => new Date("2026-08-25T00:04:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.task.status).toBe("queued");
    expect(result.recovery).toEqual({
      status: "queued",
      message: "Task recovered and queued for another run.",
    });
    expect(result.event).toMatchObject({
      type: "task_recovered",
      status: "queued",
      failureReason: null,
    });
  });

  it("creates a recovery follow-up from Partial Output and moves downstream dependencies", () => {
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        status: "failed",
        latestFailureReason: "timeout",
        latestFailureMessage: "Task failed: Record implementation changes / timeout after 3m.",
        artifactWorkspacePath: ".auto-crop/workspaces/task_1",
      },
      {
        ...createTaskRecord(),
        id: "task_2",
        title: "Prepare launch assets",
        position: 1,
        status: "waiting_dependency",
      },
    ]);
    fixture.repositories.createTaskDependency({
      taskId: "task_2",
      dependsOnTaskId: "task_1",
      handoffContract: "Use implementation notes.",
    });

    const result = recoverTask({
      repositories: fixture.repositories,
      taskId: "task_1",
      proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
      now: () => new Date("2026-08-25T00:04:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    const recoveryTask = fixture.repositories.listTasksForCompany("company_1").find((task) => task.id === "recovery_task_1");
    expect(result.followUpTask).toEqual(recoveryTask);
    expect(recoveryTask).toMatchObject({
      title: "Record implementation changes (recovery)",
      status: "queued",
      workspacePath: ".auto-crop/workspaces/task_1",
      artifactWorkspacePath: ".auto-crop/workspaces/task_1",
    });
    expect(fixture.repositories.getTask("task_1")).toMatchObject({
      status: "failed",
      latestFailureReason: "timeout",
    });
    expect(fixture.repositories.listTaskDependencies("task_2")).toEqual([
      expect.objectContaining({ taskId: "task_2", dependsOnTaskId: "recovery_task_1" }),
    ]);
    expect(result.recovery).toEqual({
      status: "follow_up_created",
      message: "Recovery task created from Partial Output and queued for another run.",
    });
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

function createAgentRunRecord(): AgentRun {
  return {
    id: "agent_run_1",
    taskId: "task_1",
    agentId: "codex",
    status: "running",
    logPath: ".auto-crop/companies/company_1/logs/task_1.log",
    startedAt: "2026-08-25T00:00:00.000Z",
    finishedAt: null,
    executionProfileName: "short",
    requestedTimeoutMs: 180_000,
    effectiveTimeoutMs: 180_000,
    failureReason: null,
    failureMessage: null,
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
