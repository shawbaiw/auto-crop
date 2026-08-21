import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Company, Department, KeyResult, Objective, Task } from "@auto-crop/core";
import type { AgentAdapter, AgentRunRequest } from "../adapters/types";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { aiSaasPlaybook } from "../playbooks/aiSaas";
import { confirmReplanProposal, createReplanProposalForTask } from "./replan";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("replan proposals", () => {
  it("creates a deterministic proposal for a task that needs replanning", async () => {
    const { repositories, client } = createFixture([
      createTaskRecord("source_task", "needs_replan", 0),
    ]);

    const proposal = await createReplanProposalForTask({
      repositories,
      taskId: "source_task",
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(proposal).toMatchObject({
      id: "replan_proposal_1",
      sourceTaskId: "source_task",
      status: "proposed",
      proposalSource: "deterministic_template",
      plannerAgentId: null,
      plannerPromptPath: null,
      rationale: "Task source_task exceeded the long execution budget and should be split into smaller proof-backed tasks.",
    });
    expect(proposal.replacementTasks.map((task) => task.title)).toEqual([
      "Plan smaller slice for Task source_task",
      "Produce proof for Task source_task",
      "Validate replacement output for Task source_task",
    ]);
    expect(repositories.listReplanProposalsForTask("source_task")).toEqual([proposal]);

    client.close();
  });

  it("uses planner agent output when planner context is provided", async () => {
    const { repositories, client } = createFixture([
      createTaskRecord("source_task", "needs_replan", 0),
      createTaskRecord("consumer_task", "waiting_dependency", 1),
    ]);
    repositories.createTaskDependency({ taskId: "consumer_task", dependsOnTaskId: "source_task" });
    const plannerRequests: AgentRunRequest[] = [];
    const plannerAgent = createPlannerAgent({
      output: [
        "```json",
        JSON.stringify({
          rationale: "Planner split the task around an explicit handoff contract.",
          replacementTasks: [
            {
              title: "Write implementation handoff",
              description: "Define the reduced prototype scope and proof contract.",
              requiredCapabilities: ["writing", "research"],
              proofSchemaId: "product-brief",
              riskLevel: "low",
            },
            {
              title: "Build reduced prototype",
              description: "Build only the approved reduced scope.",
              requiredCapabilities: ["code", "frontend"],
              proofSchemaId: "landing-page-file",
              riskLevel: "medium",
            },
          ],
        }),
        "```",
      ].join("\n"),
      onRun: (request) => {
        plannerRequests.push(request);
      },
    });

    const proposal = await createReplanProposalForTask({
      repositories,
      taskId: "source_task",
      projectRoot: mkdtempTracked(),
      plannerAgent,
      playbook: aiSaasPlaybook,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(plannerRequests[0]?.taskId).toBe("source_task_replan_planner");
    expect(plannerRequests[0]?.prompt).toContain("Task source_task");
    expect(plannerRequests[0]?.prompt).toContain("Task consumer_task");
    expect(proposal.rationale).toBe("Planner split the task around an explicit handoff contract.");
    expect(proposal).toMatchObject({
      proposalSource: "planner_agent",
      plannerAgentId: "codex",
      plannerFailureReason: null,
      plannerFailureMessage: null,
    });
    expect(proposal.plannerPromptPath).toContain("replan-source_task-prompt.md");
    expect(proposal.replacementTasks.map((task) => task.title)).toEqual([
      "Write implementation handoff",
      "Build reduced prototype",
    ]);

    client.close();
  });

  it("falls back to the deterministic template when planner output cannot be parsed", async () => {
    const { repositories, client } = createFixture([
      createTaskRecord("source_task", "needs_replan", 0),
    ]);

    const proposal = await createReplanProposalForTask({
      repositories,
      taskId: "source_task",
      projectRoot: mkdtempTracked(),
      plannerAgent: createPlannerAgent({ output: "not json" }),
      playbook: aiSaasPlaybook,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(proposal.rationale).toContain("Task source_task exceeded the long execution budget");
    expect(proposal).toMatchObject({
      proposalSource: "deterministic_template",
      plannerAgentId: "codex",
      plannerFailureReason: "parse_failed",
    });
    expect(proposal.plannerPromptPath).toContain("replan-source_task-prompt.md");
    expect(proposal.plannerFailureMessage).toMatch(/fenced json/i);
    expect(proposal.replacementTasks.map((task) => task.title)).toEqual([
      "Plan smaller slice for Task source_task",
      "Produce proof for Task source_task",
      "Validate replacement output for Task source_task",
    ]);

    client.close();
  });

  it("refuses to create a proposal for a task that does not need replanning", async () => {
    const { repositories, client } = createFixture([
      createTaskRecord("source_task", "queued", 0),
    ]);

    await expect(
      createReplanProposalForTask({
        repositories,
        taskId: "source_task",
        now: () => new Date("2026-08-17T00:00:00.000Z"),
        createId: createSequentialIdFactory(),
      }),
    ).rejects.toThrow(/does not need replanning/i);

    client.close();
  });

  it("confirms a proposal by creating replacement tasks and rewiring consumers to the final replacement", async () => {
    const source = createTaskRecord("source_task", "needs_replan", 0);
    const consumer = createTaskRecord("consumer_task", "waiting_dependency", 1);
    const { repositories, client } = createFixture([source, consumer]);
    repositories.createTaskDependency({ taskId: consumer.id, dependsOnTaskId: source.id });
    const createId = createSequentialIdFactory();
    const proposal = await createReplanProposalForTask({
      repositories,
      taskId: source.id,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId,
    });

    const result = confirmReplanProposal({
      projectRoot: mkdtempTracked(),
      repositories,
      proposalId: proposal.id,
      now: () => new Date("2026-08-17T00:01:00.000Z"),
      createId,
    });

    expect(result.createdTasks.map((task) => task.id)).toEqual(["task_1", "task_2", "task_3"]);
    expect(result.createdTasks.map((task) => task.position)).toEqual([2, 3, 4]);
    expect(repositories.listTaskDependencies("consumer_task")).toEqual([
      { taskId: "consumer_task", dependsOnTaskId: "task_3" },
    ]);
    expect(repositories.listTaskDependencies("task_3")).toEqual([
      { taskId: "task_3", dependsOnTaskId: "task_2" },
    ]);
    expect(repositories.getTask(source.id)).toMatchObject({
      status: "blocked",
      latestFailureReason: "needs_replan",
      dependencyNote: "Replaced by replan proposal replan_proposal_1.",
    });
    expect(repositories.getReplanProposal(proposal.id)).toMatchObject({
      status: "confirmed",
      confirmedAt: "2026-08-17T00:01:00.000Z",
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

function mkdtempTracked(): string {
  const dir = mkdtempSync(join(tmpdir(), "auto-crop-replan-"));
  createdDirs.push(dir);
  return dir;
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

function createTaskRecord(id: string, status: Task["status"], position: number): Task {
  return {
    id,
    companyId: "company_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    title: `Task ${id}`,
    description: "Run mock work.",
    assigneeAgentId: "mock-worker",
    requiredCapabilities: ["code", "frontend"],
    proofSchemaId: "landing-page-file",
    workspacePath: null,
    status,
    riskLevel: "medium",
    position,
    latestFailureReason: status === "needs_replan" ? "needs_replan" : null,
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

function createPlannerAgent(options: { output: string; onRun?: (request: AgentRunRequest) => void }): AgentAdapter {
  return {
    id: "codex",
    name: "Codex",
    capabilities: ["code", "frontend", "test", "writing", "research"],
    async detect() {
      return true;
    },
    async run(request) {
      options.onRun?.(request);
      return {
        status: "complete",
        exitCode: 0,
        stdout: options.output,
        stderr: "",
      };
    },
  };
}
