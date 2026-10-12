import { describe, expect, it } from "vitest";
import { ExecutionRegistry } from "./executionControl";
import type { Company, Department, KeyResult, Objective, Task } from "@auto-crop/core";
import { createMockAgentAdapter } from "../adapters/mockAgent";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { COMPANY_PAUSED_STOP_REASON, COMPANY_STOPPED_STOP_REASON, pauseCompany, resumeCompany, stopCompany } from "./companyOperation";
import { runSchedulerOnce } from "./scheduler";

describe("company operation", () => {
  it("pauses one company: it stops dispatching and its live runs are asked to stop", () => {
    const { client, repositories } = createCompanyOperationFixture();
    const stopped: Array<{ taskId: string; reason: string }> = [];
    const registry = new ExecutionRegistry();
    registry.register({
      taskId: "task_1", companyId: "company_1", runId: "agent_run_1", ownerEpoch: 1, stopReason: null,
      requestStop: (reason) => stopped.push({ taskId: "task_1", reason }),
    });
    repositories.writeTaskStatusUnchecked("task_1", "running");
    repositories.createAgentRun({
      id: "agent_run_1", taskId: "task_1", agentId: "codex", status: "running",
      logPath: "task_1.log", startedAt: "2026-08-17T00:00:00.000Z", finishedAt: null,
    });

    const result = pauseCompany({
      companyId: "company_1", repositories, executionRegistry: registry,
      now: () => new Date("2026-08-17T00:00:10.000Z"), stopCompanySessions: () => ["session_1"],
    });

    expect(result).toMatchObject({ ok: true, interruptedTasks: ["task_1"], unreachableTasks: [], stoppedSessions: ["session_1"] });
    expect(stopped).toEqual([{ taskId: "task_1", reason: COMPANY_PAUSED_STOP_REASON }]);
    expect(repositories.getCompany("company_1")?.status).toBe("paused");
    // The run settles when its process exits, not here: the task is not rewritten under a live agent.
    expect(repositories.getTask("task_1")?.status).toBe("running");
    client.close();
  });

  it("reports a running run this process cannot reach instead of counting it as stopped", () => {
    const { client, repositories } = createCompanyOperationFixture();
    repositories.writeTaskStatusUnchecked("task_1", "running");
    repositories.createAgentRun({
      id: "agent_run_1", taskId: "task_1", agentId: "codex", status: "running",
      logPath: "task_1.log", startedAt: "2026-08-17T00:00:00.000Z", finishedAt: null,
    });

    const result = pauseCompany({ companyId: "company_1", repositories, executionRegistry: new ExecutionRegistry() });

    expect(result).toMatchObject({ ok: true, interruptedTasks: [], unreachableTasks: ["task_1"] });
    client.close();
  });

  it("resumes only a paused company, and pauses only an active one", () => {
    const { client, repositories } = createCompanyOperationFixture();

    expect(resumeCompany({ companyId: "company_1", repositories })).toMatchObject({ ok: false, status: "active" });
    expect(pauseCompany({ companyId: "company_1", repositories, executionRegistry: new ExecutionRegistry() }).ok).toBe(true);
    expect(pauseCompany({ companyId: "company_1", repositories, executionRegistry: new ExecutionRegistry() })).toMatchObject({ ok: false, status: "paused" });
    expect(resumeCompany({ companyId: "company_1", repositories })).toMatchObject({ ok: true });
    expect(repositories.getCompany("company_1")?.status).toBe("active");
    client.close();
  });

  it("does not dispatch for a paused company, and dispatches again once it resumes", async () => {
    const { client, repositories } = createCompanyOperationFixture();
    const adapters = [createMockAgentAdapter({ id: "codex", name: "Codex", capabilities: ["code"] })];
    const tick = () => runSchedulerOnce({
      projectRoot: ".", repositories, adapters, workerId: "worker_a", maxTasks: 1,
      approvalRequired: () => false, proofCollector: () => [], emit: () => undefined,
    });

    pauseCompany({ companyId: "company_1", repositories, executionRegistry: new ExecutionRegistry() });
    expect((await tick()).started).toEqual([]);
    expect(repositories.getTask("task_1")?.status).toBe("queued");

    resumeCompany({ companyId: "company_1", repositories });
    expect((await tick()).started).toEqual(["task_1"]);
    client.close();
  });

  it("pausing one company leaves another company dispatching", async () => {
    const { client, repositories } = createCompanyOperationFixture();
    repositories.createCompany({ ...companyRecord(), id: "company_2", name: "Other Studio" });
    repositories.createTask({ ...taskRecord(), id: "task_2", companyId: "company_2", workspacePath: ".auto-crop/workspaces/task_2" });

    pauseCompany({ companyId: "company_1", repositories, executionRegistry: new ExecutionRegistry() });
    const result = await runSchedulerOnce({
      projectRoot: ".", repositories, adapters: [createMockAgentAdapter({ id: "codex", name: "Codex", capabilities: ["code"] })],
      workerId: "worker_a", maxTasks: 2, approvalRequired: () => false, proofCollector: () => [], emit: () => undefined,
    });

    expect(result.started).toEqual(["task_2"]);
    client.close();
  });

  it("stops a company for good: its live runs are asked to stop and a Final Founder Report is queued", () => {
    const { client, repositories } = createCompanyOperationFixture();
    const stopped: string[] = [];
    const registry = new ExecutionRegistry();
    registry.register({
      taskId: "task_1", companyId: "company_1", runId: "agent_run_1", ownerEpoch: 1, stopReason: null,
      requestStop: (reason) => stopped.push(reason),
    });

    const result = stopCompany({
      companyId: "company_1", repositories, executionRegistry: registry,
      now: () => new Date("2026-08-17T00:00:10.000Z"), createId: (prefix) => `${prefix}_1`,
    });

    expect(result).toMatchObject({ ok: true, interruptedTasks: ["task_1"] });
    expect(stopped).toEqual([COMPANY_STOPPED_STOP_REASON]);
    expect(repositories.getCompany("company_1")?.status).toBe("stopped");
    expect(repositories.getActiveFinalFounderReportJob("company_1")).toMatchObject({ status: "preparing" });
    // Stopping is final: there is nothing to resume or pause.
    expect(resumeCompany({ companyId: "company_1", repositories })).toMatchObject({ ok: false, status: "stopped" });
    expect(stopCompany({ companyId: "company_1", repositories })).toMatchObject({ ok: false, status: "stopped" });
    client.close();
  });

  it("stops a company whose creation failed without queueing a report it has nothing to report on", () => {
    const { client, repositories } = createCompanyOperationFixture();
    repositories.updateCompanyStatus("company_1", "creation_failed", "2026-08-17T00:00:00.000Z");
    repositories.writeTaskStatusUnchecked("task_1", "cancelled");
    const emptyCompany = { ...companyRecord(), id: "company_2", status: "creation_failed" as const };
    repositories.createCompany(emptyCompany);

    expect(stopCompany({ companyId: "company_2", repositories }).ok).toBe(true);
    expect(repositories.getCompany("company_2")?.status).toBe("stopped");
    expect(repositories.getActiveFinalFounderReportJob("company_2")).toBeNull();
    client.close();
  });

  it("refuses to stop a company that is still being created", () => {
    const { client, repositories } = createCompanyOperationFixture();
    repositories.updateCompanyStatus("company_1", "creating", "2026-08-17T00:00:00.000Z");

    expect(stopCompany({ companyId: "company_1", repositories })).toMatchObject({ ok: false, status: "creating" });
    client.close();
  });
});

function createCompanyOperationFixture() {
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);
  const company = companyRecord();
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
  const task = taskRecord();

  repositories.createCompany(company);
  repositories.createDepartment(department);
  repositories.createObjective(objective);
  repositories.createKeyResult(keyResult);
  repositories.createTask(task);

  return { client, repositories };
}

function companyRecord(): Company {
  return {
    id: "company_1",
    name: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    locale: "en",
    selectedCeoAgentId: "codex",
    playbookId: "ai-saas",
    status: "active",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };
}

function taskRecord(): Task {
  return {
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
}
