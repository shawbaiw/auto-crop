import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BusinessArtifact, Company, Department, KeyResult, Objective, Proof, Task } from "@auto-crop/core";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { propagateDependencyCascade, refreshDependencyTasks } from "./dependencyCascade";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("refreshDependencyTasks", () => {
  it("writes ready dependency state and is idempotent when repeated", () => {
    const { repositories, client } = createFixture([
      createTaskRecord("task_1", "complete"),
      dependencyBlockedTask("task_2", "missing_deliverable", "Missing consumable proof from dependency: Task task_1."),
    ]);
    repositories.createTaskDependency({ taskId: "task_2", dependsOnTaskId: "task_1" });
    appendProof(repositories, "proof_1", "task_1");

    const first = refreshDependencyTasks({
      repositories,
      tasks: [repositories.getTask("task_2")!],
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });
    const second = refreshDependencyTasks({
      repositories,
      tasks: [repositories.getTask("task_2")!],
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(first.updatedTasks).toHaveLength(1);
    expect(first.updatedTasks[0]?.task).toMatchObject({
      id: "task_2",
      status: "queued",
      latestFailureReason: null,
      dependencyNote: null,
    });
    expect(first.updatedTasks[0]?.event).toMatchObject({
      type: "dependency_ready",
      status: "queued",
    });
    expect(first.updatedTasks[0]?.progressEvent).toMatchObject({
      label: "Dependency ready after upstream approval; queued for scheduler.",
    });
    expect(second.updatedTasks).toEqual([]);
    expect(repositories.listTaskEventsForCompany("company_1").filter((event) => event.type === "dependency_ready")).toHaveLength(1);
    client.close();
  });

  it("writes waiting dependency state", () => {
    const { repositories, client } = createFixture([
      createTaskRecord("task_1", "running"),
      dependencyBlockedTask("task_2", "missing_deliverable", "Missing consumable proof from dependency: Task task_1."),
    ]);
    repositories.createTaskDependency({ taskId: "task_2", dependsOnTaskId: "task_1" });

    const result = refreshDependencyTasks({
      repositories,
      tasks: [repositories.getTask("task_2")!],
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(result.updatedTasks).toHaveLength(1);
    expect(result.updatedTasks[0]?.task).toMatchObject({
      id: "task_2",
      status: "waiting_dependency",
      latestFailureReason: null,
      dependencyNote: "Waiting for dependency deliverable: Task task_1 (running).",
    });
    expect(result.updatedTasks[0]?.event).toMatchObject({
      type: "dependency_waiting",
      status: "waiting_dependency",
    });
    client.close();
  });

  it("writes waiting state while an upstream dependency awaits CEO acceptance", () => {
    const { repositories, client } = createFixture([
      createTaskRecord("task_1", "review"),
      createTaskRecord("task_2", "waiting_dependency"),
    ]);
    repositories.createTaskDependency({ taskId: "task_2", dependsOnTaskId: "task_1" });

    const result = refreshDependencyTasks({
      repositories,
      tasks: [repositories.getTask("task_2")!],
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(result.updatedTasks).toHaveLength(1);
    expect(result.updatedTasks[0]?.task).toMatchObject({
      id: "task_2",
      status: "waiting_dependency",
      latestFailureReason: null,
      dependencyNote: "Waiting for dependency acceptance: Task task_1 (review).",
    });
    expect(result.updatedTasks[0]?.event).toMatchObject({
      type: "dependency_waiting",
      status: "waiting_dependency",
    });
    client.close();
  });

  it("writes blocked dependency state", () => {
    const { repositories, client } = createFixture([
      createTaskRecord("task_1", "needs_replan"),
      createTaskRecord("task_2", "waiting_dependency"),
    ]);
    repositories.createTaskDependency({ taskId: "task_2", dependsOnTaskId: "task_1" });

    const result = refreshDependencyTasks({
      repositories,
      tasks: [repositories.getTask("task_2")!],
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(result.updatedTasks).toHaveLength(1);
    expect(result.updatedTasks[0]?.task).toMatchObject({
      id: "task_2",
      status: "blocked",
      latestFailureReason: "needs_replan",
      dependencyNote: "Waiting for dependency to be replanned: Task task_1.",
    });
    expect(result.updatedTasks[0]?.event).toMatchObject({
      type: "task_blocked",
      status: "blocked",
      failureReason: "needs_replan",
    });
    client.close();
  });
});

describe("propagateDependencyCascade", () => {
  it("keeps maxDepth 1 limited to direct consumers", () => {
    const { repositories, client } = createFixture([
      createTaskRecord("task_1", "complete"),
      dependencyBlockedTask("task_2", "missing_deliverable", "Missing consumable proof from dependency: Task task_1."),
      dependencyBlockedTask("task_3", "dependency_failed", "Blocked by failed dependency: Task task_2."),
    ]);
    repositories.createTaskDependency({ taskId: "task_2", dependsOnTaskId: "task_1" });
    repositories.createTaskDependency({ taskId: "task_3", dependsOnTaskId: "task_2" });
    appendProof(repositories, "proof_1", "task_1");

    const result = propagateDependencyCascade({
      repositories,
      sourceTaskId: "task_1",
      maxDepth: 1,
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(result.updatedTasks.map((update) => update.task.id)).toEqual(["task_2"]);
    expect(repositories.getTask("task_2")?.status).toBe("queued");
    expect(repositories.getTask("task_3")?.status).toBe("blocked");
    client.close();
  });

  it("refreshes a second-level consumer after the first-level consumer becomes queued", () => {
    const { repositories, client } = createFixture([
      createTaskRecord("task_1", "complete"),
      dependencyBlockedTask("task_2", "missing_deliverable", "Missing consumable proof from dependency: Task task_1."),
      dependencyBlockedTask("task_3", "dependency_failed", "Blocked by failed dependency: Task task_2."),
    ]);
    repositories.createTaskDependency({ taskId: "task_2", dependsOnTaskId: "task_1" });
    repositories.createTaskDependency({ taskId: "task_3", dependsOnTaskId: "task_2" });
    appendProof(repositories, "proof_1", "task_1");

    const result = propagateDependencyCascade({
      repositories,
      sourceTaskId: "task_1",
      maxDepth: 2,
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(result.updatedTasks.map((update) => update.task.id)).toEqual(["task_2", "task_3"]);
    expect(result.updatedTasks[0]?.event).toMatchObject({ type: "dependency_ready", status: "queued" });
    expect(result.updatedTasks[0]?.progressEvent).toMatchObject({
      label: "Dependency ready after upstream approval; queued for scheduler.",
    });
    expect(result.updatedTasks[1]?.task).toMatchObject({
      id: "task_3",
      status: "waiting_dependency",
      dependencyNote: "Waiting for dependency deliverable: Task task_2 (queued).",
    });
    expect(result.updatedTasks[1]?.progressEvent).toBeUndefined();
    client.close();
  });

  it("does not continue propagation from waiting or blocked updates", () => {
    const { repositories, client } = createFixture([
      createTaskRecord("task_1", "complete"),
      dependencyBlockedTask("task_2", "missing_deliverable", "Missing consumable proof from dependency: Task task_1."),
      dependencyBlockedTask("task_3", "dependency_failed", "Blocked by failed dependency: Task task_2."),
      dependencyBlockedTask("task_4", "dependency_failed", "Blocked by failed dependency: Task task_3."),
    ]);
    repositories.createTaskDependency({ taskId: "task_2", dependsOnTaskId: "task_1" });
    repositories.createTaskDependency({ taskId: "task_3", dependsOnTaskId: "task_2" });
    repositories.createTaskDependency({ taskId: "task_4", dependsOnTaskId: "task_3" });
    appendProof(repositories, "proof_1", "task_1");

    const result = propagateDependencyCascade({
      repositories,
      sourceTaskId: "task_1",
      maxDepth: 5,
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(result.updatedTasks.map((update) => update.task.id)).toEqual(["task_2", "task_3"]);
    expect(repositories.getTask("task_3")?.status).toBe("waiting_dependency");
    expect(repositories.getTask("task_4")?.status).toBe("blocked");
    client.close();
  });

  it("deduplicates converging candidates and prevents cycles", () => {
    const { repositories, client } = createFixture([
      createTaskRecord("task_1", "complete"),
      dependencyBlockedTask("task_2", "missing_deliverable", "Missing consumable proof from dependency: Task task_1."),
      dependencyBlockedTask("task_3", "missing_deliverable", "Missing consumable proof from dependency: Task task_1."),
      dependencyBlockedTask("task_4", "dependency_failed", "Blocked by failed dependency."),
    ]);
    repositories.createTaskDependency({ taskId: "task_2", dependsOnTaskId: "task_1" });
    repositories.createTaskDependency({ taskId: "task_3", dependsOnTaskId: "task_1" });
    repositories.createTaskDependency({ taskId: "task_4", dependsOnTaskId: "task_2" });
    repositories.createTaskDependency({ taskId: "task_4", dependsOnTaskId: "task_3" });
    repositories.createTaskDependency({ taskId: "task_1", dependsOnTaskId: "task_4" });
    appendProof(repositories, "proof_1", "task_1");

    const result = propagateDependencyCascade({
      repositories,
      sourceTaskId: "task_1",
      maxDepth: 5,
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(result.updatedTasks.map((update) => update.task.id)).toEqual(["task_2", "task_3", "task_4"]);
    expect(result.updatedTasks.filter((update) => update.task.id === "task_4")).toHaveLength(1);
    expect(result.updatedTasks.some((update) => update.task.id === "task_1")).toBe(false);
    client.close();
  });

  it("clamps requested depth above 5 without traversing past the natural frontier", () => {
    const { repositories, client } = createFixture(
      Array.from({ length: 7 }, (_, index) =>
        index === 0
          ? createTaskRecord("task_1", "complete")
          : dependencyBlockedTask(`task_${index + 1}`, "missing_deliverable", "Missing consumable proof."),
      ),
    );
    for (let index = 2; index <= 7; index += 1) {
      repositories.createTaskDependency({ taskId: `task_${index}`, dependsOnTaskId: `task_${index - 1}` });
    }
    for (let index = 1; index <= 6; index += 1) {
      appendProof(repositories, `proof_${index}`, `task_${index}`);
    }

    const result = propagateDependencyCascade({
      repositories,
      sourceTaskId: "task_1",
      maxDepth: 99,
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(result.updatedTasks.map((update) => update.task.id)).toEqual(["task_2", "task_3"]);
    expect(repositories.getTask("task_3")?.status).toBe("waiting_dependency");
    expect(repositories.getTask("task_7")?.status).toBe("blocked");
    client.close();
  });

  it("stops a failed branch while continuing other branches", () => {
    const { repositories, client } = createFixture([
      createTaskRecord("task_1", "complete"),
      dependencyBlockedTask("task_2", "missing_deliverable", "Missing consumable proof from dependency: Task task_1."),
      dependencyBlockedTask("task_3", "missing_deliverable", "Missing consumable proof from dependency: Task task_1."),
      dependencyBlockedTask("task_4", "dependency_failed", "Blocked by failed dependency: Task task_2."),
      dependencyBlockedTask("task_5", "dependency_failed", "Blocked by failed dependency: Task task_3."),
    ]);
    repositories.createTaskDependency({ taskId: "task_2", dependsOnTaskId: "task_1" });
    repositories.createTaskDependency({ taskId: "task_3", dependsOnTaskId: "task_1" });
    repositories.createTaskDependency({ taskId: "task_4", dependsOnTaskId: "task_2" });
    repositories.createTaskDependency({ taskId: "task_5", dependsOnTaskId: "task_3" });
    appendProof(repositories, "proof_1", "task_1");
    const originalListDependencyConsumers = repositories.listDependencyConsumers;
    repositories.listDependencyConsumers = (dependsOnTaskId: string) => {
      if (dependsOnTaskId === "task_2") {
        throw new Error("consumer branch failed");
      }
      return originalListDependencyConsumers(dependsOnTaskId);
    };

    const result = propagateDependencyCascade({
      repositories,
      sourceTaskId: "task_1",
      maxDepth: 2,
      now: fixedNow,
      createId: createSequentialIdFactory(),
    });

    expect(result.updatedTasks.map((update) => update.task.id)).toEqual(["task_2", "task_3", "task_5"]);
    expect(result.errors).toEqual([{ taskId: "task_2", message: "consumer branch failed" }]);
    expect(repositories.getTask("task_4")?.status).toBe("blocked");
    client.close();
  });
});

function createFixture(tasks: Task[]) {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-cascade-"));
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
    latestFailureReason: null,
    latestFailureMessage: null,
    latestExecutionProfileName: null,
    latestRequestedTimeoutMs: null,
    latestEffectiveTimeoutMs: null,
    dependencyNote: null,
  };
}

function dependencyBlockedTask(
  id: string,
  failureReason: Task["latestFailureReason"],
  dependencyNote: string,
): Task {
  return {
    ...createTaskRecord(id, "blocked"),
    latestFailureReason: failureReason,
    latestFailureMessage: `Task blocked: ${id}.`,
    dependencyNote,
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
  repositories.createBusinessArtifact(createBusinessArtifactRecord(`artifact_${id}`, taskId, id));
}

function createBusinessArtifactRecord(id: string, taskId: string, sourceProofId: string): BusinessArtifact {
  return {
    id,
    companyId: "company_1",
    taskId,
    sourceProofId,
    artifactType: "implementation_summary",
    taskType: "test_task",
    payload: { result: `Accepted artifact for ${taskId}.` },
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
