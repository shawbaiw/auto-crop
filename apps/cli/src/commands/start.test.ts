import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Company, Department, KeyResult, Objective, Task } from "@auto-crop/core";
import {
  aiSaasPlaybook,
  createDatabaseClient,
  createMockAgentAdapter,
  createRepositories,
  migrate,
  type AgentAdapter,
} from "@auto-crop/server";
import { startAutoCrop, startSchedulerLoop } from "./start";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("startAutoCrop", () => {
  it("starts the local API server, prints the dashboard URL, and detects configured agents", async () => {
    const projectRoot = createTempProjectRoot();
    const logs: string[] = [];

    const started = await startAutoCrop({
      projectRoot,
      host: "127.0.0.1",
      port: 0,
      agents: [
        createMockAgentAdapter({
          id: "claude-code",
          name: "Claude Code",
          capabilities: ["writing", "research"],
          detected: false,
        }),
        createMockAgentAdapter({
          id: "codex",
          name: "Codex",
          capabilities: ["code", "frontend"],
          detected: true,
        }),
      ],
      log: (line) => logs.push(line),
    });

    try {
      expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(logs).toContain(`Dashboard: ${started.url}`);
      expect(logs).toContain("Agent Claude Code: unavailable");
      expect(logs).toContain("Agent Codex: available");

      const response = await fetch(`${started.url}/api/agents`);
      const body = (await response.json()) as { agents: Array<{ id: string; detected: boolean }> };
      expect(response.ok).toBe(true);
      expect(body.agents).toContainEqual({
        id: "codex",
        name: "Codex",
        capabilities: ["code", "frontend"],
        detected: true,
      });
    } finally {
      await started.close();
    }
  });

  it("automatically runs queued tasks through the scheduler loop", async () => {
    const projectRoot = createTempProjectRoot();
    const logs: string[] = [];
    const blueprint = aiSaasPlaybook.createBlueprint({
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      preferredEngineeringAgentId: "codex",
      preferredStrategyAgentId: "codex",
    });
    const agent = createMockAgentAdapter({
      id: "codex",
      name: "Codex",
      capabilities: ["code", "frontend", "test", "writing", "research", "growth"],
      output: ["## Human CEO Brief", "Validate.", "```json", JSON.stringify({ brief: "Validate.", blueprint }), "```"].join("\n"),
    });

    const started = await startAutoCrop({
      projectRoot,
      host: "127.0.0.1",
      port: 0,
      agents: [agent],
      schedulerIntervalMs: 25,
      log: (line) => logs.push(line),
    });

    try {
      const response = await fetch(`${started.url}/api/companies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyName: "Pricing Page Studio",
          founderVision: "Build an AI SaaS that creates pricing pages.",
          selectedCeoAgentId: "codex",
          permissionMode: "balanced",
          assets: [],
        }),
      });

      expect(response.ok).toBe(true);
      await waitFor(() => logs.some((line) => line.includes("Scheduler tick: started=1")));
    } finally {
      await started.close();
    }
  });

  it("uses collision-resistant ids for companies created through CLI startup", async () => {
    const projectRoot = createTempProjectRoot();
    const blueprint = aiSaasPlaybook.createBlueprint({
      companyName: "Vision Studio",
      founderVision: "Build an AI SaaS that turns founder visions into launch plans.",
      preferredEngineeringAgentId: "codex",
      preferredStrategyAgentId: "codex",
    });
    const agent = createMockAgentAdapter({
      id: "codex",
      name: "Codex",
      capabilities: ["code", "frontend", "test", "writing", "research", "growth"],
      output: ["## Human CEO Brief", "Validate.", "```json", JSON.stringify({ brief: "Validate.", blueprint }), "```"].join("\n"),
    });

    const started = await startAutoCrop({
      projectRoot,
      host: "127.0.0.1",
      port: 0,
      agents: [agent],
      schedulerIntervalMs: 60_000,
      log: () => undefined,
    });

    try {
      const created = await postJson<{
        company: { id: string; status: string };
      }>(`${started.url}/api/companies`, {
        companyName: "Vision Studio",
        founderVision: "Build an AI SaaS that turns founder visions into launch plans.",
        selectedCeoAgentId: "codex",
        permissionMode: "balanced",
        assets: [],
      });
      const state = await waitForCompanyState(started.url, created.company.id, "draft");
      const database = createDatabaseClient(join(projectRoot, ".auto-crop", "state.sqlite"));
      try {
        const repositories = createRepositories(database);
        const creationEvents = repositories.listCompanyEventsForCompany(created.company.id);

        expect(state.company.id).toMatch(/^company_[0-9a-f-]{36}$/);
        expect(state.company.id).not.toMatch(/^company_\d+$/);
        expect(creationEvents).toHaveLength(5);
        expect(new Set(creationEvents.map((event) => event.id)).size).toBe(creationEvents.length);
        expect(creationEvents.every((event) => /^company_event_[0-9a-f-]{36}$/.test(event.id))).toBe(true);
      } finally {
        database.close();
      }
    } finally {
      await started.close();
    }
  });

  it("runs wake-requested queued tasks without waiting for the scheduler interval", async () => {
    const projectRoot = createTempProjectRoot();
    const logs: string[] = [];
    const events: Array<{ type: string; taskId: string }> = [];
    const client = createDatabaseClient(":memory:");
    migrate(client);
    const repositories = createRepositories(client);
    repositories.createCompany(createCompanyRecord());
    repositories.createDepartment(createDepartmentRecord());
    repositories.createObjective(createObjectiveRecord());
    repositories.createKeyResult(createKeyResultRecord());

    const scheduler = startSchedulerLoop({
      agents: [
        {
          id: "codex",
          name: "Codex",
          capabilities: ["test"],
          detect: async () => true,
          run: async (request) => {
            mkdirSync(join(request.workspacePath, ".auto-crop"), { recursive: true });
            writeFileSync(
              join(request.workspacePath, ".auto-crop", "business-artifact.json"),
              JSON.stringify({
                artifact_kind: "deliverable",
                artifact_role: "validation",
                artifact_subtype: "scheduler_wake_validation",
                task_type: "test.scheduler_wake",
                payload: {
                  summary: "Scheduler wake task completed.",
                  outcome_summary:
                    "The wake-requested task is complete and validated. It keeps the objective on schedule; the remaining gap is CEO review before downstream work proceeds.",
                  recommendation: "Review the wake-requested task.",
                  evidence: ["proof: wake-requested scheduler tick"],
                  risks: [],
                  next_steps: ["CEO review"],
                },
                lineage: { task_id: "task_1" },
              }),
              "utf8",
            );
            return {
              status: "complete",
              exitCode: 0,
              stdout: "proof: wake-requested scheduler tick",
              stderr: "",
            };
          },
        } satisfies AgentAdapter,
      ],
      intervalMs: 60_000,
      log: (line) => logs.push(line),
      projectRoot,
      repositories,
      publish: (event) => events.push(event),
    });

    try {
      repositories.createTask(createTaskRecord());
      scheduler.requestWake("dependency_cascade_queued");

      await waitFor(() => events.some((event) => event.type === "task_started" && event.taskId === "task_1"));
      await waitFor(() => repositories.getTask("task_1")?.status === "complete");
      expect(logs).toContain("Scheduler wake requested: dependency_cascade_queued");
      expect(repositories.getTask("task_1")?.status).toBe("complete");
    } finally {
      scheduler.stop();
      client.close();
    }
  });
});

function createTempProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "auto-crop-cli-"));
  createdDirs.push(dir);
  return dir;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as T;
}

async function waitForCompanyState(
  baseUrl: string,
  companyId: string,
  status: string,
): Promise<{
  company: { id: string; status: string };
  creationEvents: Array<{ type: string }>;
}> {
  let latestState:
    | {
        company: { id: string; status: string };
        creationEvents: Array<{ type: string }>;
      }
    | undefined;

  await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/companies/${companyId}/state`);
    if (!response.ok) {
      return false;
    }
    latestState = (await response.json()) as typeof latestState;
    return latestState?.company.status === status;
  });

  return latestState!;
}

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  const startedAt = Date.now();

  while (!(await check())) {
    if (Date.now() - startedAt > 2_000) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
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
    responsibility: "Run local checks.",
    leadAgentId: "codex",
    memoryPath: ".auto-crop/companies/company_1/departments/engineering/memory.md",
  };
}

function createObjectiveRecord(): Objective {
  return {
    id: "objective_1",
    companyId: "company_1",
    title: "Validate scheduler wake",
    status: "active",
    priority: 1,
  };
}

function createKeyResultRecord(): KeyResult {
  return {
    id: "key_result_1",
    objectiveId: "objective_1",
    title: "Wake-requested task produced proof",
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
    title: "Run wake-requested scheduler task",
    description: "Produce command output proof after a scheduler wake request.",
    assigneeAgentId: "codex",
    requiredCapabilities: ["test"],
    proofSchemaId: "test-output",
    workspacePath: null,
    status: "queued",
    riskLevel: "low",
    position: 0,
    latestFailureReason: null,
    latestFailureMessage: null,
    latestExecutionProfileName: null,
    latestRequestedTimeoutMs: null,
    latestEffectiveTimeoutMs: null,
    dependencyNote: null,
    parentTaskId: null,
    taskKind: "parent",
    source: "ceo",
  };
}
