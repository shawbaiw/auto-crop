import { describe, expect, it } from "vitest";
import type { Company, Department, KeyResult, Objective, Proof, Task } from "@auto-crop/core";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { propagateParentTaskAggregation } from "./parentTaskAggregation";

describe("propagateParentTaskAggregation", () => {
  it("queues a waiting parent for proof summarization when all department subtasks are ready", () => {
    const { repositories, client } = createFixture([
      parentTask("task_parent", "waiting_dependency"),
      departmentSubtask("subtask_1", "review"),
      departmentSubtask("subtask_2", "review"),
    ]);
    repositories.createTaskDependency({ taskId: "task_parent", dependsOnTaskId: "subtask_1" });
    repositories.createTaskDependency({ taskId: "task_parent", dependsOnTaskId: "subtask_2" });
    appendProof(repositories, "proof_1", "subtask_1");
    appendProof(repositories, "proof_2", "subtask_2");

    const result = propagateParentTaskAggregation({
      repositories,
      sourceSubtaskId: "subtask_2",
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(result.errors).toEqual([]);
    expect(result.updatedTasks).toHaveLength(1);
    expect(result.updatedTasks[0]?.task).toMatchObject({
      id: "task_parent",
      status: "queued",
      latestFailureReason: null,
      latestFailureMessage: null,
      dependencyNote: null,
    });
    expect(result.updatedTasks[0]?.event).toMatchObject({
      type: "dependency_ready",
      taskId: "task_parent",
      status: "queued",
      message: "Parent task queued for proof summarization: Parent Task.",
    });
    expect(result.updatedTasks[0]?.progressEvent).toMatchObject({
      parentTaskId: "task_parent",
      subjectTaskId: "task_parent",
      step: "summarizing_proof",
      status: "current",
      label: "Ready to summarize department subtask proof.",
    });
    client.close();
  });

  it("checks ordinary dependencies before queuing a mixed-dependency parent", () => {
    const { repositories, client } = createFixture([
      parentTask("task_parent", "waiting_dependency"),
      departmentSubtask("subtask_1", "review"),
      createTaskRecord("task_ordinary", "review", "parent"),
    ]);
    repositories.createTaskDependency({ taskId: "task_parent", dependsOnTaskId: "subtask_1" });
    repositories.createTaskDependency({ taskId: "task_parent", dependsOnTaskId: "task_ordinary" });
    appendProof(repositories, "proof_1", "subtask_1");

    const result = propagateParentTaskAggregation({
      repositories,
      sourceSubtaskId: "subtask_1",
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(result.updatedTasks).toHaveLength(1);
    expect(result.updatedTasks[0]?.task).toMatchObject({
      id: "task_parent",
      status: "blocked",
      latestFailureReason: "missing_deliverable",
      dependencyNote: "Missing consumable proof from dependency: Ordinary Dependency.",
    });
    expect(result.updatedTasks[0]?.event).toMatchObject({
      type: "deliverable_missing",
      failureReason: "missing_deliverable",
    });
    client.close();
  });

  it("blocks a parent when another department subtask is blocked", () => {
    const { repositories, client } = createFixture([
      parentTask("task_parent", "waiting_dependency"),
      departmentSubtask("subtask_ready", "review"),
      departmentSubtask("subtask_blocked", "blocked"),
    ]);
    repositories.createTaskDependency({ taskId: "task_parent", dependsOnTaskId: "subtask_ready" });
    repositories.createTaskDependency({ taskId: "task_parent", dependsOnTaskId: "subtask_blocked" });
    appendProof(repositories, "proof_1", "subtask_ready");

    const result = propagateParentTaskAggregation({
      repositories,
      sourceSubtaskId: "subtask_ready",
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(result.updatedTasks).toHaveLength(1);
    expect(result.updatedTasks[0]?.task).toMatchObject({
      id: "task_parent",
      status: "blocked",
      latestFailureReason: "dependency_failed",
      dependencyNote: "Blocked by department subtask: Blocked Department Subtask (blocked).",
    });
    expect(result.updatedTasks[0]?.progressEvent).toMatchObject({
      step: "blocked",
      status: "blocked",
      subjectTaskId: "subtask_blocked",
      label: "Blocked by Blocked Department Subtask.",
    });
    client.close();
  });

  it("is idempotent when repeated after the parent state changes", () => {
    const { repositories, client } = createFixture([
      parentTask("task_parent", "waiting_dependency"),
      departmentSubtask("subtask_1", "review"),
    ]);
    repositories.createTaskDependency({ taskId: "task_parent", dependsOnTaskId: "subtask_1" });
    appendProof(repositories, "proof_1", "subtask_1");

    const first = propagateParentTaskAggregation({
      repositories,
      sourceSubtaskId: "subtask_1",
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });
    const second = propagateParentTaskAggregation({
      repositories,
      sourceSubtaskId: "subtask_1",
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(first.updatedTasks).toHaveLength(1);
    expect(second.updatedTasks).toEqual([]);
    expect(repositories.listTaskEventsForCompany("company_1").filter((event) => event.type === "dependency_ready")).toHaveLength(1);
    client.close();
  });

  it("does not rewrite ineligible parent statuses", () => {
    const { repositories, client } = createFixture([
      {
        ...parentTask("task_parent", "queued"),
        dependencyNote: "Stale note.",
      },
      departmentSubtask("subtask_1", "review"),
    ]);
    repositories.createTaskDependency({ taskId: "task_parent", dependsOnTaskId: "subtask_1" });
    appendProof(repositories, "proof_1", "subtask_1");

    const result = propagateParentTaskAggregation({
      repositories,
      sourceSubtaskId: "subtask_1",
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(result.updatedTasks).toEqual([]);
    expect(repositories.getTask("task_parent")).toMatchObject({
      status: "queued",
      dependencyNote: "Stale note.",
    });
    client.close();
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

function parentTask(id: string, status: Task["status"]): Task {
  return {
    ...createTaskRecord(id, status, "parent"),
    title: "Parent Task",
    dependencyNote: status === "waiting_dependency" ? "Waiting for department subtasks." : null,
  };
}

function departmentSubtask(id: string, status: Task["status"]): Task {
  const titles: Record<string, string> = {
    subtask_1: "Ready Department Subtask",
    subtask_2: "Second Ready Department Subtask",
    subtask_ready: "Ready Department Subtask",
    subtask_blocked: "Blocked Department Subtask",
  };

  return {
    ...createTaskRecord(id, status, "department_subtask"),
    title: titles[id] ?? `Subtask ${id}`,
    parentTaskId: "task_parent",
  };
}

function createTaskRecord(id: string, status: Task["status"], taskKind: Task["taskKind"]): Task {
  const title = id === "task_ordinary" ? "Ordinary Dependency" : `Task ${id}`;

  return {
    id,
    companyId: "company_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    title,
    description: "Run mock work.",
    assigneeAgentId: "mock-worker",
    requiredCapabilities: ["code"],
    proofSchemaId: "test-output",
    workspacePath: null,
    status,
    riskLevel: "low",
    position: 0,
    latestFailureReason: null,
    latestFailureMessage: null,
    latestExecutionProfileName: null,
    latestRequestedTimeoutMs: null,
    latestEffectiveTimeoutMs: null,
    dependencyNote: null,
    parentTaskId: taskKind === "department_subtask" ? "task_parent" : null,
    taskKind,
    source: taskKind === "department_subtask" ? "department" : "ceo",
  };
}

function appendProof(repositories: ReturnType<typeof createRepositories>, id: string, taskId: string) {
  repositories.appendProof({
    id,
    taskId,
    type: "file",
    uri: `${taskId}-proof.md`,
    summary: `Proof for ${taskId}.`,
    verifiedAt: null,
  } satisfies Proof);
}

function fixedNow(): Date {
  return new Date("2026-08-17T00:00:00.000Z");
}

function createSequentialIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}
