import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Company, Department, KeyResult, Objective, Proof, Task } from "@auto-crop/core";
import type { AgentAdapter } from "../adapters/types";
import { createMockAgentAdapter } from "../adapters/mockAgent";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { acquireTaskLock, releaseTaskLock } from "./locks";
import { runSchedulerOnce } from "./scheduler";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("task locks", () => {
  it("allows only one owner to hold a task lock and releases it", () => {
    const client = createDatabaseClient(":memory:");
    migrate(client);

    expect(acquireTaskLock(client, "task_1", "worker_a", "2026-08-17T00:00:00.000Z")).toBe(true);
    expect(acquireTaskLock(client, "task_1", "worker_b", "2026-08-17T00:00:01.000Z")).toBe(false);

    releaseTaskLock(client, "task_1", "worker_a");

    expect(acquireTaskLock(client, "task_1", "worker_b", "2026-08-17T00:00:02.000Z")).toBe(true);

    client.close();
  });
});

describe("runSchedulerOnce", () => {
  it("claims queued tasks, dispatches mock agents, writes logs, appends proof, and moves tasks to review", async () => {
    const { projectRoot, repositories, client } = createSchedulerFixture([
      createTaskRecord("task_1", "queued", "low"),
      createTaskRecord("task_2", "queued", "low"),
    ]);
    const events: SchedulerEventRecord[] = [];

    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [
        createMockAgentAdapter({
          id: "mock-worker",
          name: "Mock Worker",
          capabilities: ["code"],
          output: "proof: created artifact",
        }),
      ],
      workerId: "worker_a",
      maxTasks: 2,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
      approvalRequired: () => false,
      proofCollector: ({ task }) => [
        {
          id: `proof_${task.id}`,
          taskId: task.id,
          type: "command_output",
          uri: "agent.log",
          summary: "mock proof",
          verifiedAt: null,
        },
      ],
      emit: (event) => events.push(event),
    });

    expect(result.started).toEqual(["task_1", "task_2"]);
    expect(result.completed).toEqual(["task_1", "task_2"]);
    expect(repositories.getTask("task_1")?.status).toBe("review");
    expect(repositories.getTask("task_2")?.status).toBe("review");
    expect(repositories.listProofsForTask("task_1")).toHaveLength(1);
    expect(existsSync(join(projectRoot, ".auto-crop", "companies", "company_1", "logs", "task_1.log"))).toBe(
      true,
    );
    expect(readFileSync(join(projectRoot, ".auto-crop", "companies", "company_1", "logs", "task_1.log"), "utf8")).toContain(
      "proof: created artifact",
    );
    expect(events).toContainEqual({
      type: "task_started",
      taskId: "task_1",
      message: "Task started: Task task_1 (mock-worker, long budget 10m).",
    });
    expect(events.map((event) => `${event.type}:${event.taskId}`)).toContain("task_log:task_1");
    expect(events.map((event) => `${event.type}:${event.taskId}`)).toContain("task_review:task_1");

    client.close();
  });

  it("blocks approval-required tasks before dispatch", async () => {
    const { projectRoot, repositories, client } = createSchedulerFixture([
      createTaskRecord("task_1", "queued", "high"),
    ]);

    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [
        createMockAgentAdapter({
          id: "mock-worker",
          name: "Mock Worker",
          capabilities: ["code"],
        }),
      ],
      workerId: "worker_a",
      maxTasks: 1,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
      approvalRequired: (task) => task.riskLevel === "high",
      proofCollector: () => [],
      emit: () => undefined,
    });

    expect(result.blocked).toEqual(["task_1"]);
    expect(repositories.getTask("task_1")?.status).toBe("blocked");
    expect(repositories.fetchQueuedTasks(10)).toEqual([]);

    client.close();
  });

  it("marks dispatched tasks failed when no proof is present", async () => {
    const { projectRoot, repositories, client } = createSchedulerFixture([
      createTaskRecord("task_1", "queued", "low"),
    ]);

    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [
        createMockAgentAdapter({
          id: "mock-worker",
          name: "Mock Worker",
          capabilities: ["code"],
        }),
      ],
      workerId: "worker_a",
      maxTasks: 1,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
      approvalRequired: () => false,
      proofCollector: () => [],
      emit: () => undefined,
    });

    expect(result.failed).toEqual(["task_1"]);
    expect(repositories.getTask("task_1")?.status).toBe("failed");

    client.close();
  });

  it("does not collect proof from failed agent output and emits timeout reason", async () => {
    const { projectRoot, repositories, client } = createSchedulerFixture([
      createTaskRecord("task_1", "queued", "low"),
    ]);
    const events: SchedulerEventRecord[] = [];
    let proofCollectorCalls = 0;

    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [
        createMockAgentAdapter({
          id: "mock-worker",
          name: "Mock Worker",
          capabilities: ["code"],
          output: "# Partial output",
          status: "failed",
          failureReason: "timeout",
        }),
      ],
      workerId: "worker_a",
      maxTasks: 1,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
      approvalRequired: () => false,
      proofCollector: () => {
        proofCollectorCalls += 1;
        return [
          {
            id: "proof_1",
            taskId: "task_1",
            type: "command_output",
            uri: "agent.log",
            summary: "partial output",
            verifiedAt: null,
          },
        ];
      },
      emit: (event) => events.push(event),
    });

    expect(result.failed).toEqual(["task_1"]);
    expect(proofCollectorCalls).toBe(0);
    expect(repositories.listProofsForTask("task_1")).toEqual([]);
    expect(repositories.getTask("task_1")?.status).toBe("failed");
    expect(events).toContainEqual({
      type: "task_failed",
      taskId: "task_1",
      failureReason: "timeout",
      message: "Task failed: Task task_1 / timeout after 10m.",
    });

    client.close();
  });

  it("passes the resolved task execution timeout to the adapter", async () => {
    const { projectRoot, repositories, client } = createSchedulerFixture([
      createTaskRecord("task_1", "queued", "low", "landing-page-file"),
    ]);
    let timeoutMs: number | undefined;

    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [
        {
          id: "mock-worker",
          name: "Mock Worker",
          capabilities: ["code"],
          detect: async () => true,
          run: async (request) => {
            timeoutMs = request.timeoutMs;
            return {
              status: "complete",
              exitCode: 0,
              stdout: "done",
              stderr: "",
            };
          },
        } satisfies AgentAdapter,
      ],
      workerId: "worker_a",
      maxTasks: 1,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
      approvalRequired: () => false,
      proofCollector: ({ task }) => [
        {
          id: `proof_${task.id}`,
          taskId: task.id,
          type: "file",
          uri: "app/page.tsx",
          summary: "file proof",
          verifiedAt: null,
        },
      ],
      emit: () => undefined,
    });

    expect(timeoutMs).toBe(600_000);
    expect(result.completed).toEqual(["task_1"]);

    client.close();
  });

  it("fails only the current task when proof capture throws", async () => {
    const { projectRoot, repositories, client } = createSchedulerFixture([
      createTaskRecord("task_1", "queued", "low"),
      createTaskRecord("task_2", "queued", "low"),
    ]);
    const events: SchedulerEventRecord[] = [];

    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [
        createMockAgentAdapter({
          id: "mock-worker",
          name: "Mock Worker",
          capabilities: ["code"],
        }),
      ],
      workerId: "worker_a",
      maxTasks: 2,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
      approvalRequired: () => false,
      proofCollector: ({ task }) => {
        if (task.id === "task_1") {
          throw new Error("schema missing");
        }

        return [
          {
            id: `proof_${task.id}`,
            taskId: task.id,
            type: "command_output",
            uri: "agent.log",
            summary: "mock proof",
            verifiedAt: null,
          },
        ];
      },
      emit: (event) => events.push(event),
    });

    expect(result.failed).toEqual(["task_1"]);
    expect(result.completed).toEqual(["task_2"]);
    expect(repositories.getTask("task_1")?.status).toBe("failed");
    expect(repositories.getTask("task_2")?.status).toBe("review");
    expect(repositories.listTaskLocks()).toEqual([]);
    expect(events).toContainEqual({
      type: "task_failed",
      taskId: "task_1",
      failureReason: "proof_capture_failed",
      message: "Task failed: Task task_1 / proof_capture_failed / schema missing",
    });

    client.close();
  });
});

function createSchedulerFixture(tasks: Task[]) {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-scheduler-"));
  createdDirs.push(projectRoot);
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);
  const company = createCompanyRecord();
  const department = createDepartmentRecord();
  const objective = createObjectiveRecord();
  const keyResult = createKeyResultRecord();

  repositories.createCompany(company);
  repositories.createDepartment(department);
  repositories.createObjective(objective);
  repositories.createKeyResult(keyResult);
  for (const task of tasks) {
    repositories.createTask(task);
  }

  return { projectRoot, repositories, client };
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

function createTaskRecord(
  id: string,
  status: Task["status"],
  riskLevel: Task["riskLevel"],
  proofSchemaId = "test-output",
): Task {
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
    proofSchemaId,
    workspacePath: null,
    status,
    riskLevel,
    position: Number.isFinite(numericSuffix) ? numericSuffix - 1 : 0,
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

type SchedulerEventRecord = {
  type: "task_started" | "task_log" | "task_review" | "task_failed" | "task_blocked";
  taskId: string;
  message: string;
  failureReason?: "timeout" | "agent_failed" | "no_proof" | "proof_capture_failed";
};
