import { afterEach, describe, expect, it } from "vitest";
import type { BusinessArtifact, Company, Department, KeyResult, Objective, Proof, Task } from "@auto-crop/core";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { reconcileReviewTasksForAutomaticAcceptance } from "./reviewReconciliation";

const clients: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.close();
  }
});

const NOW = () => new Date("2026-09-03T00:00:00.000Z");

describe("reconcileReviewTasksForAutomaticAcceptance", () => {
  it("accepts a qualifying review task through the shared seam with no outcome summary and cascades downstream", () => {
    const { repositories } = createFixture([
      createTaskRecord("task_1", "review"),
      { ...createTaskRecord("task_2", "waiting_dependency"), dependencyNote: "Waiting for dependency deliverable: Task task_1 (review)." },
    ]);
    repositories.createTaskDependency({ taskId: "task_2", dependsOnTaskId: "task_1" });
    repositories.createBusinessArtifact(
      createArtifactRecord("business_artifact_1", "task_1", { summary: "Prototype implementation complete." }),
    );

    const result = reconcileReviewTasksForAutomaticAcceptance({
      repositories,
      companyId: "company_1",
      now: NOW,
      createId: createSequentialIdFactory(),
    });

    expect(result.acceptedTaskIds).toEqual(["task_1"]);
    expect(repositories.getTask("task_1")?.status).toBe("complete");
    expect(repositories.getCurrentBusinessArtifactForTask("task_1")?.reviewStatus).toBe("accepted");
    expect(repositories.getTask("task_2")?.status).toBe("queued");

    const [completion] = repositories.listTaskCompletionEventsForCompany("company_1");
    expect(completion).toMatchObject({
      taskId: "task_1",
      outcome: "accepted",
      acceptanceProvenance: "automatic_acceptance",
    });
    expect(completion).not.toHaveProperty("outcomeSummaryText");
  });

  it("is idempotent: a second run accepts nothing and changes no state", () => {
    const { repositories } = createFixture([createTaskRecord("task_1", "review")]);
    repositories.createBusinessArtifact(
      createArtifactRecord("business_artifact_1", "task_1", { summary: "Prototype implementation complete." }),
    );

    const createId = createSequentialIdFactory();
    reconcileReviewTasksForAutomaticAcceptance({ repositories, companyId: "company_1", now: NOW, createId });

    const completionsAfterFirst = repositories.listTaskCompletionEventsForCompany("company_1");
    const eventsAfterFirst = repositories.listTaskEventsForCompany("company_1");

    const second = reconcileReviewTasksForAutomaticAcceptance({ repositories, companyId: "company_1", now: NOW, createId });

    expect(second.acceptedTaskIds).toEqual([]);
    expect(second.events).toEqual([]);
    expect(repositories.listTaskCompletionEventsForCompany("company_1")).toEqual(completionsAfterFirst);
    expect(repositories.listTaskEventsForCompany("company_1")).toEqual(eventsAfterFirst);
  });

  it("leaves a risk-pattern-caught review task in place", () => {
    const { repositories } = createFixture([
      { ...createTaskRecord("task_1", "review"), description: "Deploy the service to production once signed off." },
    ]);
    repositories.createBusinessArtifact(
      createArtifactRecord("business_artifact_1", "task_1", { summary: "Prototype implementation complete." }),
    );

    const result = reconcileReviewTasksForAutomaticAcceptance({
      repositories,
      companyId: "company_1",
      now: NOW,
      createId: createSequentialIdFactory(),
    });

    expect(result.acceptedTaskIds).toEqual([]);
    expect(repositories.getTask("task_1")?.status).toBe("review");
    expect(repositories.getCurrentBusinessArtifactForTask("task_1")?.reviewStatus).toBe("unreviewed");
    expect(repositories.listTaskCompletionEventsForCompany("company_1")).toEqual([]);
  });

  it("leaves a review task that declares a kept Founder Decision in place", () => {
    const { repositories } = createFixture([createTaskRecord("task_1", "review")]);
    repositories.createBusinessArtifact(
      createArtifactRecord("business_artifact_1", "task_1", {
        summary: "Pricing brief complete.",
        open_decisions: [
          {
            decisionKind: "pricing_model",
            options: [
              { label: "Flat monthly fee", tradeoffs: "Predictable revenue; underprices heavy users." },
              { label: "Usage-based", tradeoffs: "Scales with value; harder to forecast." },
            ],
            recommendation: "Flat monthly fee",
            rationale: "Early buyers want a predictable bill.",
          },
        ],
      }),
    );

    const result = reconcileReviewTasksForAutomaticAcceptance({
      repositories,
      companyId: "company_1",
      now: NOW,
      createId: createSequentialIdFactory(),
    });

    expect(result.acceptedTaskIds).toEqual([]);
    expect(repositories.getTask("task_1")?.status).toBe("review");
    expect(repositories.listTaskCompletionEventsForCompany("company_1")).toEqual([]);
  });

  it("does not touch complete or blocked tasks", () => {
    const { repositories } = createFixture([
      createTaskRecord("task_1", "complete"),
      createTaskRecord("task_2", "blocked"),
    ]);
    repositories.createBusinessArtifact(
      createArtifactRecord("business_artifact_1", "task_1", { summary: "done" }, { reviewStatus: "unreviewed" }),
    );
    repositories.createBusinessArtifact(
      createArtifactRecord("business_artifact_2", "task_2", { summary: "done" }, { reviewStatus: "unreviewed" }),
    );

    const result = reconcileReviewTasksForAutomaticAcceptance({
      repositories,
      companyId: "company_1",
      now: NOW,
      createId: createSequentialIdFactory(),
    });

    expect(result.acceptedTaskIds).toEqual([]);
    expect(repositories.getTask("task_1")?.status).toBe("complete");
    expect(repositories.getTask("task_2")?.status).toBe("blocked");
    expect(repositories.listTaskCompletionEventsForCompany("company_1")).toEqual([]);
  });
});

function createFixture(tasks: Task[]) {
  const client = createDatabaseClient(":memory:");
  migrate(client);
  clients.push(client);
  const repositories = createRepositories(client);

  repositories.createCompany(createCompanyRecord());
  repositories.createDepartment(createDepartmentRecord());
  repositories.createObjective(createObjectiveRecord());
  repositories.createKeyResult(createKeyResultRecord());
  for (const task of tasks) {
    repositories.createTask(task);
    repositories.appendProof(createProofRecord(task.id));
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
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
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
  return { id: "objective_1", companyId: "company_1", title: "Validate the first wedge", status: "active", priority: 1 };
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
    riskLevel: "medium",
    position: Number.isFinite(numericSuffix) ? numericSuffix - 1 : 0,
  };
}

function createArtifactRecord(
  id: string,
  taskId: string,
  payload: unknown,
  overrides: Partial<BusinessArtifact> = {},
): BusinessArtifact {
  return {
    id,
    companyId: "company_1",
    taskId,
    sourceProofId: `proof_${taskId}`,
    artifactKind: "deliverable",
    artifactRole: "implementation",
    artifactSubtype: "prototype_implementation",
    artifactType: "implementation_summary",
    taskType: "engineering.prototype_implementation",
    payload,
    lineage: { founder_vision: "Build an AI SaaS that creates pricing pages." },
    validationStatus: "valid",
    validationErrors: [],
    reviewStatus: "unreviewed",
    isCurrent: true,
    supersedesArtifactId: null,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    ...overrides,
  };
}

function createProofRecord(taskId: string): Proof {
  return {
    id: `proof_${taskId}`,
    taskId,
    type: "command_output",
    uri: "agent.log",
    summary: "mock proof",
    verifiedAt: null,
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
