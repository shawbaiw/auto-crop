import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BusinessArtifact, Company, Department, KeyResult, Objective, Proof, Task } from "@auto-crop/core";
import type { AgentAdapter } from "../adapters/types";
import { createMockAgentAdapter } from "../adapters/mockAgent";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { acquireTaskLock, releaseTaskLock } from "./locks";
import { createHandoffPackage, createProofCollector } from "./proof";
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
  it("reconciles stale running tasks before dispatching queued work", async () => {
    const { projectRoot, repositories, client } = createSchedulerFixture([
      createTaskRecord("task_1", "running", "low"),
    ]);
    repositories.acquireTaskLock("task_1", "worker_old", "2026-08-17T00:00:00.000Z");
    repositories.createAgentRun({
      id: "agent_run_1",
      taskId: "task_1",
      agentId: "mock-worker",
      status: "running",
      logPath: "agent.log",
      startedAt: "2026-08-17T00:00:00.000Z",
      finishedAt: null,
      executionProfileName: "short",
      requestedTimeoutMs: 1_000,
      effectiveTimeoutMs: 1_000,
      failureReason: null,
      failureMessage: null,
    });

    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [
        createMockAgentAdapter({
          id: "mock-worker",
          name: "Mock Worker",
          capabilities: ["code"],
          output: "proof: should not run",
        }),
      ],
      workerId: "worker_a",
      maxTasks: 1,
      now: () => new Date("2026-08-17T00:00:02.000Z"),
      createId: createSequentialIdFactory(),
      approvalRequired: () => false,
      proofCollector: () => [],
      emit: () => undefined,
    });

    expect(result.started).toEqual([]);
    expect(repositories.getTask("task_1")).toMatchObject({
      status: "failed",
      latestFailureReason: "timeout",
    });
    expect(repositories.listTaskLocks()).toEqual([]);
    expect(repositories.listRunningAgentRuns("company_1")).toEqual([]);

    client.close();
  });

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
      proofCollector: ({ task }) => {
        writeValidBusinessArtifact(task);
        return [createProofForTask(task)];
      },
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
    expect(existsSync(join(projectRoot, ".auto-crop", "workspaces", "task_1", ".auto-crop-handoff", "package.json"))).toBe(
      true,
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

  it("blocks completed tasks that have proof but no reviewable business artifact", async () => {
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
          output: "proof: created markdown only",
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
          type: "command_output",
          uri: "agent.log",
          summary: "mock proof",
          verifiedAt: null,
        },
      ],
      emit: () => undefined,
    });

    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual(["task_1"]);
    expect(repositories.getTask("task_1")).toMatchObject({
      status: "blocked",
      latestFailureReason: "missing_business_artifact",
    });
    expect(repositories.getCurrentBusinessArtifactForTask("task_1")).toMatchObject({
      artifactKind: "blocker",
      artifactRole: "none",
      validationStatus: "invalid_schema",
      reviewStatus: "not_reviewable",
    });

    client.close();
  });

  it("assesses large department parent tasks and creates department subtasks before execution", async () => {
    const largeParentTask = {
      ...createTaskRecord("task_1", "queued", "low", "landing-page-file"),
      title: "Build the playable web prototype",
      description: "Build the playable web prototype, validate it locally, capture proof, and prepare it for deployment.",
      requiredCapabilities: ["code", "frontend", "test"],
    };
    const { projectRoot, repositories, client } = createSchedulerFixture([largeParentTask]);

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
      maxTasks: 1,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
      approvalRequired: () => false,
      proofCollector: () => [],
      emit: () => undefined,
    });

    const tasks = repositories.listTasksForCompany("company_1");
    const subtaskTitles = tasks.filter((task) => task.parentTaskId === "task_1").map((task) => task.title);

    expect(result.started).toEqual([]);
    expect(repositories.getTask("task_1")?.status).toBe("waiting_dependency");
    expect(subtaskTitles).toEqual([
      "Define executable slice for Build the playable web prototype",
      "Execute Build the playable web prototype",
      "Validate proof for Build the playable web prototype",
    ]);
    expect(repositories.listTaskDependencies("task_1").map((dependency) => dependency.dependsOnTaskId)).toEqual([
      "department_subtask_1",
      "department_subtask_2",
      "department_subtask_3",
    ]);
    expect(repositories.listTaskProgressEventsForCompany("company_1").map((event) => event.step)).toEqual([
      "received",
      "assessment_complete",
      "split_complete",
      "executing",
    ]);

    client.close();
  });

  it("queues a parent for proof summarization when the final department subtask reaches review", async () => {
    const parent = {
      ...createTaskRecord("task_1", "waiting_dependency", "low"),
      title: "Build the playable web prototype",
      dependencyNote: "Waiting for department subtasks.",
      taskKind: "parent" as const,
    };
    const readySubtask = {
      ...createTaskRecord("department_subtask_1", "review", "low"),
      title: "Define executable slice for Build the playable web prototype",
      parentTaskId: parent.id,
      taskKind: "department_subtask" as const,
      source: "department" as const,
    };
    const finalSubtask = {
      ...createTaskRecord("department_subtask_2", "queued", "low"),
      title: "Validate proof for Build the playable web prototype",
      parentTaskId: parent.id,
      taskKind: "department_subtask" as const,
      source: "department" as const,
    };
    const { projectRoot, repositories, client } = createSchedulerFixture([parent, readySubtask, finalSubtask]);
    const events: SchedulerEventRecord[] = [];
    repositories.createTaskDependency({ taskId: parent.id, dependsOnTaskId: readySubtask.id });
    repositories.createTaskDependency({ taskId: parent.id, dependsOnTaskId: finalSubtask.id });
    repositories.appendProof({
      id: "proof_ready",
      taskId: readySubtask.id,
      type: "command_output",
      uri: "ready.log",
      summary: "ready proof",
      verifiedAt: null,
    });

    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [
        createMockAgentAdapter({
          id: "mock-worker",
          name: "Mock Worker",
          capabilities: ["code"],
          output: "proof: final subtask",
        }),
      ],
      workerId: "worker_a",
      maxTasks: 1,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
      approvalRequired: () => false,
      proofCollector: ({ task }) => {
        writeValidBusinessArtifact(task);
        return [{ ...createProofForTask(task), summary: "final proof" }];
      },
      emit: (event) => events.push(event),
    });

    expect(result.completed).toEqual([finalSubtask.id]);
    expect(repositories.getTask(parent.id)).toMatchObject({
      status: "queued",
      latestFailureReason: null,
      latestFailureMessage: null,
      dependencyNote: null,
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "dependency_ready",
      taskId: parent.id,
      status: "queued",
      message: "Parent task queued for proof summarization: Build the playable web prototype.",
    }));
    expect(repositories.listTaskProgressEventsForParentTask(parent.id)).toContainEqual(
      expect.objectContaining({
        step: "summarizing_proof",
        status: "current",
        subjectTaskId: parent.id,
        label: "Ready to summarize department subtask proof.",
      }),
    );

    client.close();
  });

  it("blocks a parent when a department subtask fails during scheduler execution", async () => {
    const parent = {
      ...createTaskRecord("task_1", "waiting_dependency", "low"),
      title: "Build the playable web prototype",
      dependencyNote: "Waiting for department subtasks.",
      taskKind: "parent" as const,
    };
    const subtask = {
      ...createTaskRecord("department_subtask_1", "queued", "low"),
      title: "Execute prototype slice",
      parentTaskId: parent.id,
      taskKind: "department_subtask" as const,
      source: "department" as const,
    };
    const { projectRoot, repositories, client } = createSchedulerFixture([parent, subtask]);
    const events: SchedulerEventRecord[] = [];
    repositories.createTaskDependency({ taskId: parent.id, dependsOnTaskId: subtask.id });

    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [
        createMockAgentAdapter({
          id: "mock-worker",
          name: "Mock Worker",
          capabilities: ["code"],
          output: "finished without proof",
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

    expect(result.failed).toEqual([subtask.id]);
    expect(repositories.getTask(parent.id)).toMatchObject({
      status: "blocked",
      latestFailureReason: "dependency_failed",
      dependencyNote: "Blocked by department subtask: Execute prototype slice (failed).",
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "task_blocked",
      taskId: parent.id,
      status: "blocked",
      failureReason: "dependency_failed",
    }));

    client.close();
  });

  it("cleans generated dependency directories after task execution while preserving artifacts", async () => {
    const { projectRoot, repositories, client } = createSchedulerFixture([
      createTaskRecord("task_1", "queued", "low", "landing-page-file"),
    ]);
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
            mkdirSync(join(workspacePath, "node_modules", "vite"), { recursive: true });
            writeFileSync(join(workspacePath, "node_modules", "vite", "index.js"), "module.exports = {}\n", "utf8");
            writeFileSync(join(workspacePath, "index.html"), "<main>Prototype</main>\n", "utf8");
            return {
              status: "complete",
              exitCode: 0,
              stdout: "prototype complete",
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
      proofCollector: ({ task }) => {
        writeValidBusinessArtifact(task);
        return [
          {
            ...createProofForTask(task),
            type: "file",
            uri: join(workspacePath, "index.html"),
            summary: "file proof",
          },
        ];
      },
      emit: () => undefined,
    });

    expect(result.completed).toEqual(["task_1"]);
    expect(existsSync(join(workspacePath, "index.html"))).toBe(true);
    expect(existsSync(join(workspacePath, "node_modules"))).toBe(false);
    expect(existsSync(join(workspacePath, ".auto-crop-handoff", "package.json"))).toBe(true);

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

  it("explains the required repo-diff proof locations when repo-diff proof is missing", async () => {
    const { projectRoot, repositories, client } = createSchedulerFixture([
      createTaskRecord("task_1", "queued", "low", "repo-diff"),
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

    const task = repositories.getTask("task_1");
    expect(result.failed).toEqual(["task_1"]);
    expect(task?.status).toBe("failed");
    expect(task?.latestFailureMessage).toContain("repo-diff proof missing");
    expect(task?.latestFailureMessage).toContain(".auto-crop-proof/*.diff");
    expect(task?.latestFailureMessage).toContain("top-level workspace *.diff/*.patch");
    expect(task?.latestFailureMessage).toContain(".auto-crop/business-artifact.json is not diff proof");

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
      proofCollector: ({ task }) => {
        writeValidBusinessArtifact(task);
        return [
          {
            ...createProofForTask(task),
            type: "file",
            uri: "product-brief.md",
            summary: "file proof",
          },
        ];
      },
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
      proofCollector: ({ task }) => {
        writeValidBusinessArtifact(task);
        return [
          {
            ...createProofForTask(task),
            type: "file",
            uri: "app/page.tsx",
            summary: "file proof",
          },
        ];
      },
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

  it("waits dependent tasks when upstream review work is not CEO accepted", async () => {
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

    expect(result.blocked).toEqual([]);
    expect(repositories.getTask("task_2")).toMatchObject({
      status: "waiting_dependency",
      latestFailureReason: null,
      dependencyNote: "Waiting for dependency acceptance: Task task_1 (review).",
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "dependency_waiting",
      taskId: "task_2",
      dependencyNote: "Waiting for dependency acceptance: Task task_1 (review).",
    }));

    client.close();
  });

  it("injects upstream proof handoffs into dependent agent prompts", async () => {
    const producerWorkspace = mkdtempSync(join(tmpdir(), "auto-crop-upstream-"));
    createdDirs.push(producerWorkspace);
    const proofPath = join(producerWorkspace, "product-brief.md");
    writeFileSync(proofPath, "# Product Brief\n", "utf8");
    const producer = {
      ...createTaskRecord("task_1", "complete", "low", "product-brief"),
      workspacePath: producerWorkspace,
      artifactWorkspacePath: producerWorkspace,
    };
    const consumer = createTaskRecord("task_2", "queued", "low", "test-output");
    const { projectRoot, repositories, client } = createSchedulerFixture([producer, consumer]);
    repositories.createTaskDependency({
      taskId: consumer.id,
      dependsOnTaskId: producer.id,
      handoffContract: "Consume the product brief before validating the prototype.",
    });
    const proof: Proof = {
      id: "proof_1",
      taskId: producer.id,
      type: "file",
      uri: proofPath,
      summary: "File proof: product-brief.md",
      verifiedAt: null,
    };
    repositories.appendProof(proof);
    repositories.createBusinessArtifact(createBusinessArtifactRecord("business_artifact_upstream", producer.id, proof.id));
    createHandoffPackage({
      task: producer,
      proofs: [proof],
      workspacePath: producerWorkspace,
      logPath: join(producerWorkspace, "agent.log"),
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
      proofCollector: ({ task }) => {
        writeValidBusinessArtifact(task);
        return [createProofForTask(task)];
      },
      emit: () => undefined,
    });

    expect(result.completed).toEqual(["task_2"]);
    expect(prompt).toContain("## Upstream Handoffs");
    expect(prompt).toContain("Task: Task task_1");
    expect(prompt).toContain("Business Artifact: deliverable / spec / mvp_brief / business_artifact_upstream");
    expect(prompt).toContain("Task Type: product_planning");
    expect(prompt).toContain('"selected_keyword":"pricing page generator"');
    expect(prompt).toContain("Source Proof: file / proof_1");
    expect(prompt).toContain(`Source URI: ${proofPath}`);
    expect(prompt).toContain("Handoff Contract: Consume the product brief before validating the prototype.");
    expect(prompt).toContain(`Handoff Package: ${join(producerWorkspace, ".auto-crop-handoff", "package.json")}`);
    expect(prompt).toContain(`Artifact Workspace: ${producerWorkspace}`);

    client.close();
  });

  it("collects proof and business artifacts from the actual run workspace", async () => {
    const producerWorkspace = mkdtempSync(join(tmpdir(), "auto-crop-upstream-"));
    createdDirs.push(producerWorkspace);
    const producer = {
      ...createTaskRecord("task_1", "complete", "low", "landing-page-file"),
      workspacePath: producerWorkspace,
      artifactWorkspacePath: producerWorkspace,
    };
    const consumerWorkspace = mkdtempSync(join(tmpdir(), "auto-crop-consumer-"));
    createdDirs.push(consumerWorkspace);
    const consumer = {
      ...createTaskRecord("task_2", "queued", "low", "repo-diff"),
      workspacePath: consumerWorkspace,
      artifactWorkspacePath: consumerWorkspace,
    };
    const { projectRoot, repositories, client } = createSchedulerFixture([producer, consumer]);
    repositories.appendProof({
      id: "proof_1",
      taskId: producer.id,
      type: "file",
      uri: join(producerWorkspace, "index.html"),
      summary: "File proof: index.html",
      verifiedAt: null,
    });
    repositories.createBusinessArtifact(createBusinessArtifactRecord("business_artifact_upstream", producer.id, "proof_1"));
    repositories.createTaskDependency({
      taskId: consumer.id,
      dependsOnTaskId: producer.id,
      handoffContract: "Record the implementation changes from the built prototype workspace.",
    });
    let adapterWorkspacePath = "";

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
            adapterWorkspacePath = request.workspacePath;
            mkdirSync(join(request.workspacePath, ".auto-crop-proof"), { recursive: true });
            writeFileSync(
              join(request.workspacePath, ".auto-crop-proof", `${request.taskId}.diff`),
              "diff --git a/index.html b/index.html\nnew file mode 100644\n",
              "utf8",
            );
            mkdirSync(join(request.workspacePath, ".auto-crop"), { recursive: true });
            writeFileSync(
              join(request.workspacePath, ".auto-crop", "business-artifact.json"),
              JSON.stringify({
                artifact_kind: "deliverable",
                artifact_role: "implementation",
                artifact_subtype: "prototype_implementation",
                task_type: "engineering.implementation_changes",
                payload: { summary: "Recorded implementation diff." },
                lineage: { upstream_task_id: producer.id },
              }),
              "utf8",
            );
            return {
              status: "complete",
              exitCode: 0,
              stdout: "recorded implementation changes",
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
      proofCollector: createProofCollector({
        proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
        createId: (prefix) => `${prefix}_collected`,
      }),
      emit: () => undefined,
    });

    const proof = repositories.listProofsForTask(consumer.id);
    const artifact = repositories.getCurrentBusinessArtifactForTask(consumer.id);
    expect(result.completed).toEqual([consumer.id]);
    expect(adapterWorkspacePath).toBe(producerWorkspace);
    expect(repositories.getTask(consumer.id)).toMatchObject({
      status: "review",
      artifactWorkspacePath: producerWorkspace,
    });
    expect(proof).toEqual([
      expect.objectContaining({
        taskId: consumer.id,
        type: "diff",
        uri: join(producerWorkspace, ".auto-crop-proof", `${consumer.id}.diff`),
      }),
    ]);
    expect(artifact).toMatchObject({
      taskId: consumer.id,
      artifactKind: "deliverable",
      reviewStatus: "unreviewed",
      validationStatus: "valid",
    });

    client.close();
  });

  it("includes registerable repo-diff proof locations in agent prompts", async () => {
    const { projectRoot, repositories, client } = createSchedulerFixture([
      createTaskRecord("task_1", "queued", "low", "repo-diff"),
    ]);
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
      proofCollector: ({ task }) => {
        writeValidBusinessArtifact(task);
        return [createProofForTask(task)];
      },
      emit: () => undefined,
    });

    expect(result.completed).toEqual(["task_1"]);
    expect(prompt).toContain("## Proof Contract");
    expect(prompt).toContain("Original Proof Schema: repo-diff");
    expect(prompt).toContain(".auto-crop-proof/task_1.diff");
    expect(prompt).toContain("top-level workspace `.diff` or `.patch` file");
    expect(prompt).toContain("Files under `.auto-crop/` are not proof for repo-diff tasks.");

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
      proofCollector: ({ task }) => {
        writeValidBusinessArtifact(task);
        return [
          {
            ...createProofForTask(task),
            type: "diff",
            uri: "task.diff",
            summary: "diff proof",
          },
        ];
      },
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

  it("includes repo-diff proof locations in scheduler-created Partial Output follow-ups", async () => {
    const producer = {
      ...createTaskRecord("task_1", "queued", "low", "repo-diff"),
      artifactWorkspacePath: ".auto-crop/workspaces/task_1",
    };
    const { projectRoot, repositories, client } = createSchedulerFixture([producer]);

    await runSchedulerOnce({
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
      emit: () => undefined,
    });

    const followUpTask = repositories
      .listTasksForCompany("company_1")
      .find((task) => task.title === "Continue from Partial Output: Task task_1");
    expect(followUpTask?.description).toContain("## Proof Contract");
    expect(followUpTask?.description).toContain("Original Proof Schema: repo-diff");
    expect(followUpTask?.description).toContain(".auto-crop-proof/task_1.diff");
    expect(followUpTask?.description).toContain("Files under `.auto-crop/` are not proof for repo-diff tasks.");

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
      proofCollector: ({ task }) => {
        writeValidBusinessArtifact(task);
        return [
          {
            ...createProofForTask(task),
            type: "file",
            uri: "index.html",
            summary: "file proof",
          },
        ];
      },
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

        writeValidBusinessArtifact(task);
        return [createProofForTask(task)];
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

function createProofForTask(task: Task): Proof {
  return {
    id: `proof_${task.id}`,
    taskId: task.id,
    type: "command_output",
    uri: "agent.log",
    summary: "mock proof",
    verifiedAt: null,
  };
}

function writeValidBusinessArtifact(task: Task): void {
  if (!task.workspacePath) {
    throw new Error(`Task ${task.id} has no workspace path`);
  }

  mkdirSync(join(task.workspacePath, ".auto-crop"), { recursive: true });
  writeFileSync(
    join(task.workspacePath, ".auto-crop", "business-artifact.json"),
    JSON.stringify({
      artifact_kind: "deliverable",
      artifact_role: "implementation",
      artifact_subtype: "prototype_implementation",
      task_type: "engineering.prototype_implementation",
      payload: {
        summary: "Mock implementation completed.",
        recommendation: "Review the completed mock proof.",
        evidence: ["mock proof"],
        risks: [],
        next_steps: ["CEO review"],
      },
      lineage: { task_id: task.id },
    }),
    "utf8",
  );
}

function createBusinessArtifactRecord(id: string, taskId: string, sourceProofId: string): BusinessArtifact {
  return {
    id,
    companyId: "company_1",
    taskId,
    sourceProofId,
    artifactKind: "deliverable",
    artifactRole: "spec",
    artifactSubtype: "mvp_brief",
    artifactType: "product_mvp_brief",
    taskType: "product_planning",
    payload: {
      selected_keyword: "pricing page generator",
      target_user: "solo SaaS founders",
      mvp_scope: "one-page pricing copy generator",
    },
    lineage: {
      founder_vision: "Build an AI SaaS that creates pricing pages.",
      objective: "Validate the first wedge",
    },
    validationStatus: "valid",
    validationErrors: [],
    reviewStatus: "accepted",
    isCurrent: true,
    supersedesArtifactId: null,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
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
