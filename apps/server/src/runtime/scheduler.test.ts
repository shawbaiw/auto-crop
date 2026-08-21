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
import { runSchedulerOnce, type SchedulerEvent } from "./scheduler";

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
    expect(events).toContainEqual(expect.objectContaining({
      type: "task_started",
      taskId: "task_1",
      message: "Task started: Task task_1 (mock-worker, long budget 10m).",
      executionProfileName: "long",
      requestedTimeoutMs: 600_000,
      effectiveTimeoutMs: 600_000,
    }));
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

  it("does not collect proof from failed agent output and emits failure reason", async () => {
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
          failureReason: "agent_failed",
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
    expect(events).toContainEqual(expect.objectContaining({
      type: "task_failed",
      taskId: "task_1",
      failureReason: "agent_failed",
      message: "Task failed: Task task_1 / agent_failed.",
    }));

    client.close();
  });

  it("retries timed-out short tasks once with a medium execution budget", async () => {
    const { projectRoot, repositories, client } = createSchedulerFixture([
      createTaskRecord("task_1", "queued", "low", "product-brief"),
    ]);
    const timeoutCalls: Array<number | undefined> = [];
    const events: SchedulerEventRecord[] = [];

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
            timeoutCalls.push(request.timeoutMs);

            if (timeoutCalls.length === 1) {
              return {
                status: "failed",
                exitCode: null,
                stdout: "",
                stderr: "timed out",
                failureReason: "timeout",
              };
            }

            return {
              status: "complete",
              exitCode: 0,
              stdout: "# Product brief",
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
          uri: "product-brief.md",
          summary: "file proof",
          verifiedAt: null,
        },
      ],
      emit: (event) => events.push(event),
    });

    expect(timeoutCalls).toEqual([120_000, 300_000]);
    expect(result.failed).toEqual([]);
    expect(result.completed).toEqual(["task_1"]);
    expect(repositories.getTask("task_1")).toMatchObject({
      status: "review",
      latestExecutionProfileName: "medium",
      latestRequestedTimeoutMs: 300_000,
      latestEffectiveTimeoutMs: 300_000,
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "task_retrying",
      taskId: "task_1",
      message: "Task warning: Task task_1 / timed out after 2m; retrying with medium budget 5m.",
      executionProfileName: "medium",
      requestedTimeoutMs: 300_000,
      effectiveTimeoutMs: 300_000,
    }));

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

  it("skips queued tasks waiting on dependencies and dispatches later eligible work", async () => {
    const producer = createTaskRecord("task_1", "running", "low", "landing-page-file");
    const waiting = createTaskRecord("task_2", "queued", "low", "test-output");
    const independent = createTaskRecord("task_3", "queued", "low", "product-brief");
    const { projectRoot, repositories, client } = createSchedulerFixture([producer, waiting, independent]);
    repositories.createTaskDependency({ taskId: waiting.id, dependsOnTaskId: producer.id });
    const events: SchedulerEventRecord[] = [];

    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [
        createMockAgentAdapter({
          id: "mock-worker",
          name: "Mock Worker",
          capabilities: ["code"],
          output: "brief proof",
        }),
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
          uri: "product-brief.md",
          summary: "mock proof",
          verifiedAt: null,
        },
      ],
      emit: (event) => events.push(event),
    });

    expect(result.started).toEqual(["task_3"]);
    expect(repositories.getTask("task_2")?.status).toBe("waiting_dependency");
    expect(repositories.getTask("task_2")?.dependencyNote).toBe(
      "Waiting for dependency deliverable: Task task_1 (running).",
    );
    expect(events).toContainEqual(expect.objectContaining({
      type: "dependency_waiting",
      taskId: "task_2",
      dependencyNote: "Waiting for dependency deliverable: Task task_1 (running).",
    }));

    client.close();
  });

  it("marks dependent tasks as waiting_dependency while upstream deliverables are still running", async () => {
    const producer = createTaskRecord("task_1", "running", "low", "landing-page-file");
    const waiting = createTaskRecord("task_2", "queued", "low", "test-output");
    const independent = createTaskRecord("task_3", "queued", "low", "product-brief");
    const { projectRoot, repositories, client } = createSchedulerFixture([producer, waiting, independent]);
    repositories.createTaskDependency({ taskId: waiting.id, dependsOnTaskId: producer.id });
    const events: SchedulerEventRecord[] = [];

    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [
        createMockAgentAdapter({
          id: "mock-worker",
          name: "Mock Worker",
          capabilities: ["code"],
          output: "brief proof",
        }),
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
          uri: "product-brief.md",
          summary: "mock proof",
          verifiedAt: null,
        },
      ],
      emit: (event) => events.push(event),
    });

    expect(result.started).toEqual(["task_3"]);
    expect(repositories.getTask("task_2")?.status).toBe("waiting_dependency");
    expect(repositories.getTask("task_2")?.dependencyNote).toBe(
      "Waiting for dependency deliverable: Task task_1 (running).",
    );
    expect(events).toContainEqual(expect.objectContaining({
      type: "dependency_waiting",
      taskId: "task_2",
      dependencyNote: "Waiting for dependency deliverable: Task task_1 (running).",
    }));

    client.close();
  });

  it("blocks dependent tasks when upstream review work has no consumable proof", async () => {
    const producer = createTaskRecord("task_1", "review", "low", "product-brief");
    const consumer = createTaskRecord("task_2", "queued", "low", "test-output");
    const { projectRoot, repositories, client } = createSchedulerFixture([producer, consumer]);
    repositories.createTaskDependency({
      taskId: consumer.id,
      dependsOnTaskId: producer.id,
      handoffContract: "Consume the product brief before validating the prototype.",
    });
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
      maxTasks: 1,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
      approvalRequired: () => false,
      proofCollector: () => [],
      emit: (event) => events.push(event),
    });

    expect(result.blocked).toEqual(["task_2"]);
    expect(repositories.getTask("task_2")).toMatchObject({
      status: "blocked",
      latestFailureReason: "missing_deliverable",
      dependencyNote: "Missing consumable proof from dependency: Task task_1.",
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "deliverable_missing",
      taskId: "task_2",
      failureReason: "missing_deliverable",
    }));

    client.close();
  });

  it("injects upstream proof handoffs into dependent agent prompts", async () => {
    const producer = {
      ...createTaskRecord("task_1", "review", "low", "product-brief"),
      artifactWorkspacePath: "/tmp/artifact-workspace",
    };
    const consumer = createTaskRecord("task_2", "queued", "low", "test-output");
    const { projectRoot, repositories, client } = createSchedulerFixture([producer, consumer]);
    repositories.createTaskDependency({
      taskId: consumer.id,
      dependsOnTaskId: producer.id,
      handoffContract: "Consume the product brief before validating the prototype.",
    });
    repositories.appendProof({
      id: "proof_1",
      taskId: producer.id,
      type: "file",
      uri: "/tmp/artifact-workspace/product-brief.md",
      summary: "File proof: product-brief.md",
      verifiedAt: null,
    });
    let prompt = "";

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
            prompt = request.prompt;
            return {
              status: "complete",
              exitCode: 0,
              stdout: "handoff consumed",
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
          type: "command_output",
          uri: "agent.log",
          summary: "mock proof",
          verifiedAt: null,
        },
      ],
      emit: () => undefined,
    });

    expect(result.completed).toEqual(["task_2"]);
    expect(prompt).toContain("## Upstream Handoffs");
    expect(prompt).toContain("Task: Task task_1");
    expect(prompt).toContain("Proof: file / proof_1");
    expect(prompt).toContain("URI: /tmp/artifact-workspace/product-brief.md");
    expect(prompt).toContain("Handoff Contract: Consume the product brief before validating the prototype.");

    client.close();
  });

  it("retries timed-out medium tasks once with a long execution budget", async () => {
    const { projectRoot, repositories, client } = createSchedulerFixture([
      createTaskRecord("task_1", "queued", "low", "repo-diff"),
    ]);
    const timeoutCalls: Array<number | undefined> = [];

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
            timeoutCalls.push(request.timeoutMs);

            if (timeoutCalls.length === 1) {
              return {
                status: "failed",
                exitCode: null,
                stdout: "",
                stderr: "timed out",
                failureReason: "timeout",
              };
            }

            return {
              status: "complete",
              exitCode: 0,
              stdout: "diff complete",
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
          type: "diff",
          uri: "task.diff",
          summary: "diff proof",
          verifiedAt: null,
        },
      ],
      emit: () => undefined,
    });

    expect(timeoutCalls).toEqual([300_000, 600_000]);
    expect(result.completed).toEqual(["task_1"]);
    expect(repositories.getTask("task_1")).toMatchObject({
      status: "review",
      latestExecutionProfileName: "long",
      latestRequestedTimeoutMs: 600_000,
      latestEffectiveTimeoutMs: 600_000,
    });

    client.close();
  });

  it("marks long timed-out tasks as needs_replan instead of retrying forever", async () => {
    const { projectRoot, repositories, client } = createSchedulerFixture([
      createTaskRecord("task_1", "queued", "low", "landing-page-file"),
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
          status: "failed",
          failureReason: "timeout",
        }),
      ],
      workerId: "worker_a",
      maxTasks: 1,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
      approvalRequired: () => false,
      proofCollector: () => [],
      emit: (event) => events.push(event),
    });

    expect(result.failed).toEqual([]);
    expect(result.blocked).toEqual(["task_1"]);
    expect(repositories.getTask("task_1")).toMatchObject({
      status: "needs_replan",
      latestFailureReason: "needs_replan",
      latestFailureMessage: "Task needs replanning: Task task_1 / exceeded long budget 10m.",
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "task_needs_replan",
      taskId: "task_1",
      failureReason: "needs_replan",
      message: "Task needs replanning: Task task_1 / exceeded long budget 10m.",
    }));

    client.close();
  });

  it("immediately blocks direct dependency consumers when a producer fails", async () => {
    const producer = createTaskRecord("task_1", "queued", "low", "landing-page-file");
    const consumer = createTaskRecord("task_2", "queued", "low", "test-output");
    const { projectRoot, repositories, client } = createSchedulerFixture([producer, consumer]);
    repositories.createTaskDependency({ taskId: consumer.id, dependsOnTaskId: producer.id });
    const events: SchedulerEventRecord[] = [];

    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [
        createMockAgentAdapter({
          id: "mock-worker",
          name: "Mock Worker",
          capabilities: ["code"],
          status: "failed",
          failureReason: "agent_failed",
        }),
      ],
      workerId: "worker_a",
      maxTasks: 1,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
      approvalRequired: () => false,
      proofCollector: () => [],
      emit: (event) => events.push(event),
    });

    expect(result.failed).toEqual(["task_1"]);
    expect(result.blocked).toEqual(["task_2"]);
    expect(repositories.getTask("task_2")).toMatchObject({
      status: "blocked",
      latestFailureReason: "dependency_failed",
      dependencyNote: "Blocked by failed dependency: Task task_1.",
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "task_blocked",
      taskId: "task_2",
      failureReason: "dependency_failed",
    }));

    client.close();
  });

  it("creates a follow-up task from Partial Output and rewires downstream consumers", async () => {
    const producer = {
      ...createTaskRecord("task_1", "queued", "low", "landing-page-file"),
      artifactWorkspacePath: ".auto-crop/workspaces/task_1",
    };
    const consumer = createTaskRecord("task_2", "queued", "low", "test-output");
    const { projectRoot, repositories, client } = createSchedulerFixture([producer, consumer]);
    repositories.createTaskDependency({
      taskId: consumer.id,
      dependsOnTaskId: producer.id,
      handoffContract: "Consume the finished prototype files.",
    });
    const events: SchedulerEventRecord[] = [];

    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [
        createMockAgentAdapter({
          id: "mock-worker",
          name: "Mock Worker",
          capabilities: ["code"],
          status: "failed",
          failureReason: "agent_failed",
        }),
      ],
      workerId: "worker_a",
      maxTasks: 1,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
      approvalRequired: () => false,
      proofCollector: () => [],
      emit: (event) => events.push(event),
    });

    const followUpTask = repositories
      .listTasksForCompany("company_1")
      .find((task) => task.title === "Continue from Partial Output: Task task_1");

    expect(result.failed).toEqual(["task_1"]);
    expect(result.blocked).toEqual([]);
    expect(repositories.getTask("task_1")).toMatchObject({
      status: "failed",
      latestFailureReason: "agent_failed",
    });
    expect(followUpTask).toMatchObject({
      id: "follow_up_task_1",
      status: "queued",
      workspacePath: ".auto-crop/workspaces/task_1",
      artifactWorkspacePath: ".auto-crop/workspaces/task_1",
      proofSchemaId: "landing-page-file",
    });
    expect(followUpTask?.description).toContain("Partial Output Source Task: task_1");
    expect(followUpTask?.description).toContain("Partial Output is not Proof");
    expect(repositories.listTaskDependencies(consumer.id)).toEqual([
      {
        taskId: consumer.id,
        dependsOnTaskId: followUpTask?.id,
        handoffContract: "Consume the finished prototype files.",
      },
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      type: "partial_output",
      taskId: "task_1",
      artifactWorkspacePath: ".auto-crop/workspaces/task_1",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "task_warning",
      taskId: "task_1",
      message:
        "Follow-up task created: Continue from Partial Output: Task task_1 will continue from Partial Output at .auto-crop/workspaces/task_1.",
    }));

    client.close();
  });

  it("runs Partial Output follow-up tasks in the partial artifact workspace", async () => {
    const followUpTask = {
      ...createTaskRecord("follow_up_task_1", "queued", "low", "landing-page-file"),
      title: "Continue from Partial Output: Task task_1",
      description: [
        "Continue the failed task from its Partial Output and produce valid Proof.",
        "",
        "Partial Output Source Task: task_1",
      ].join("\n"),
      workspacePath: ".auto-crop/workspaces/task_1",
      artifactWorkspacePath: ".auto-crop/workspaces/task_1",
    };
    const { projectRoot, repositories, client } = createSchedulerFixture([followUpTask]);
    let workspacePath = "";

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
            workspacePath = request.workspacePath;
            return {
              status: "complete",
              exitCode: 0,
              stdout: "finished partial output",
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
          uri: "index.html",
          summary: "file proof",
          verifiedAt: null,
        },
      ],
      emit: () => undefined,
    });

    expect(result.completed).toEqual(["follow_up_task_1"]);
    expect(workspacePath).toBe(".auto-crop/workspaces/task_1");
    expect(repositories.getTask("follow_up_task_1")?.status).toBe("review");

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
    expect(events).toContainEqual(expect.objectContaining({
      type: "task_failed",
      taskId: "task_1",
      failureReason: "proof_capture_failed",
      message: "Task failed: Task task_1 / proof_capture_failed / schema missing",
    }));

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

type SchedulerEventRecord = SchedulerEvent;
