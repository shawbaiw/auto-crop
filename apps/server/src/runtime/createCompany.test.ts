import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMockAgentAdapter } from "../adapters/mockAgent";
import type { AgentAdapter, AgentSession } from "../adapters/types";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { aiSaasPlaybook } from "../playbooks/aiSaas";
import { createCompany } from "./createCompany";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createCompany", () => {
  it("creates a draft company from founder vision, selected CEO, permission mode, and assets", async () => {
    const projectRoot = createTempProjectRoot();
    const client = createDatabaseClient(":memory:");
    migrate(client);
    const repositories = createRepositories(client);
    const blueprint = aiSaasPlaybook.createBlueprint({
      companyName: "CEO Renamed Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      preferredEngineeringAgentId: "codex",
      preferredStrategyAgentId: "claude-code",
    });
    const ceoAgent = createMockAgentAdapter({
      id: "codex",
      name: "Codex",
      capabilities: ["code", "frontend", "test"],
      output: ["## Human CEO Brief", "Validate the wedge.", "```json", JSON.stringify({
        brief: "Validate the wedge.",
        blueprint,
      }), "```"].join("\n"),
    });

    const result = await createCompany({
      projectRoot,
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgent: ceoAgent,
      availableAgents: [
        ceoAgent,
        createMockAgentAdapter({
          id: "claude-code",
          name: "Claude Code",
          capabilities: ["writing", "research", "growth"],
        }),
      ],
      permissionMode: "balanced",
      assets: ["README.md"],
      repositories,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.company.name).toBe("Pricing Page Studio");
    expect(result.company.playbookId).toBe("ai-saas");
    expect(result.company.permissionMode).toBe("balanced");
    expect(result.company.status).toBe("draft");

    expect(repositories.getCompany(result.company.id)?.name).toBe("Pricing Page Studio");
    expect(repositories.getCompany(result.company.id)?.permissionMode).toBe("balanced");
    expect(repositories.listDepartments(result.company.id).map((department) => department.name)).toEqual([
      "Product",
      "Research",
      "Growth",
      "Engineering",
    ]);
    expect(repositories.listObjectives(result.company.id)).toHaveLength(1);
    expect(repositories.listKeyResults(result.company.id)).toHaveLength(2);
    expect(repositories.fetchQueuedTasks(10).length).toBeGreaterThan(0);
    expect(result.tasks.map((task) => task.position)).toEqual(result.tasks.map((_, index) => index));
    expect(repositories.listTasksForCompany(result.company.id).map((task) => task.title)).toEqual(
      result.tasks.map((task) => task.title),
    );
    const buildTask = result.tasks.find((task) => task.proofSchemaId === "landing-page-file");
    const validationTask = result.tasks.find((task) => task.proofSchemaId === "test-output");
    const productTask = result.tasks.find((task) => task.title === "Write the first product brief");
    const researchTask = result.tasks.find((task) => task.title === "Create competitor and customer pain research");
    const growthTask = result.tasks.find((task) => task.title === "Draft early acquisition assets");
    expect(buildTask?.artifactWorkspacePath).toBe(buildTask?.workspacePath);
    expect(buildTask?.description).toContain("Prototype guidance");
    expect(validationTask && buildTask && productTask && researchTask && growthTask).toBeTruthy();
    expect(repositories.listTaskDependencies(growthTask?.id ?? "")).toEqual([
      {
        taskId: growthTask?.id,
        dependsOnTaskId: productTask?.id,
        handoffContract: "Produce a concise product brief with target customer, wedge, MVP scope, and first revenue path.",
      },
      {
        taskId: growthTask?.id,
        dependsOnTaskId: researchTask?.id,
        handoffContract: "Produce a research report covering comparable products, positioning, pricing, and customer pain.",
      },
    ]);
    expect(repositories.listTaskDependencies(validationTask?.id ?? "")).toEqual([
      {
        taskId: validationTask?.id,
        dependsOnTaskId: buildTask?.id,
        handoffContract:
          "Produce runnable prototype files that implement the approved wedge, research-informed positioning, and launch copy.",
      },
    ]);

    const engineering = repositories
      .listDepartments(result.company.id)
      .find((department) => department.name === "Engineering");
    expect(engineering).toBeDefined();
    expect(existsSync(engineering?.memoryPath ?? "")).toBe(true);

    client.close();
  });

  it("does not let upstream input words override an implementation task proof schema", async () => {
    const projectRoot = createTempProjectRoot();
    const client = createDatabaseClient(":memory:");
    migrate(client);
    const repositories = createRepositories(client);
    const blueprint = aiSaasPlaybook.createBlueprint({
      companyName: "CEO Renamed Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      preferredEngineeringAgentId: "codex",
      preferredStrategyAgentId: "claude-code",
    });
    blueprint.tasks = [
      {
        key: "build_from_brief",
        departmentName: "Engineering",
        title: "Build the runnable MVP prototype",
        description:
          "Implement a runnable browser prototype from the accepted upstream MVP brief, including the core workflow and local validation surface.",
        assigneeAgentId: "codex",
        requiredCapabilities: ["code", "frontend", "test"],
        proofSchemaId: "landing-page-file",
        riskLevel: "medium",
        dependsOnTaskKeys: [],
        handoffContract: "Produce runnable prototype files that implement the accepted product direction.",
      },
    ];
    const ceoAgent = createMockAgentAdapter({
      id: "codex",
      name: "Codex",
      capabilities: ["code", "frontend", "test"],
      output: ["## Human CEO Brief", "Build the implementation slice.", "```json", JSON.stringify({
        brief: "Build the implementation slice.",
        blueprint,
      }), "```"].join("\n"),
    });

    const result = await createCompany({
      projectRoot,
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgent: ceoAgent,
      availableAgents: [
        ceoAgent,
        createMockAgentAdapter({
          id: "claude-code",
          name: "Claude Code",
          capabilities: ["writing", "research", "growth"],
        }),
      ],
      permissionMode: "balanced",
      assets: [],
      repositories,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      title: "Build the runnable MVP prototype",
      proofSchemaId: "landing-page-file",
    });
    expect(result.tasks[0]?.description).toContain("Prototype guidance");
    expect(repositories.listTaskEventsForCompany(result.company.id)).not.toContainEqual(
      expect.objectContaining({
        type: "task_warning",
        message: expect.stringContaining("proof schema changed from landing-page-file to product-brief"),
      }),
    );

    client.close();
  });

  it("surfaces stdout when a failing CEO agent has no stderr", async () => {
    const projectRoot = createTempProjectRoot();
    const client = createDatabaseClient(":memory:");
    migrate(client);
    const repositories = createRepositories(client);
    const failingAgent: AgentAdapter = {
      id: "claude-code",
      name: "Claude Code",
      capabilities: ["writing"],
      async detect() {
        return true;
      },
      async run() {
        return {
          status: "failed",
          exitCode: 1,
          stdout: "Not logged in · Please run /login",
          stderr: "",
        };
      },
    };

    await expect(
      createCompany({
        projectRoot,
        companyName: "Pricing Page Studio",
        founderVision: "Build an AI SaaS that creates pricing pages.",
        selectedCeoAgent: failingAgent,
        availableAgents: [failingAgent],
        permissionMode: "balanced",
        assets: [],
        repositories,
      }),
    ).rejects.toThrow(/not logged in/i);

    client.close();
  });

  it("uses an opt-in persistent session for the CEO blueprint request", async () => {
    const projectRoot = createTempProjectRoot();
    const client = createDatabaseClient(":memory:");
    migrate(client);
    const repositories = createRepositories(client);
    const blueprint = aiSaasPlaybook.createBlueprint({
      companyName: "Session Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      preferredEngineeringAgentId: "codex",
      preferredStrategyAgentId: "codex",
    });
    const sessionRuns: string[] = [];
    const session: AgentSession = {
      id: "session_1",
      key: {
        companyId: "company_1",
        agentId: "codex",
        permissionMode: "balanced",
      },
      alive: true,
      async run(request) {
        sessionRuns.push(request.taskId);
        return {
          status: "complete",
          exitCode: 0,
          stdout: ["```json", JSON.stringify({ brief: "Session brief.", blueprint }), "```"].join("\n"),
          stderr: "",
        };
      },
      stop() {
        this.alive = false;
      },
    };
    const ceoAgent: AgentAdapter = {
      id: "codex",
      name: "Codex",
      capabilities: ["code", "frontend", "test"],
      async detect() {
        return true;
      },
      async run() {
        throw new Error("one-shot fallback should not run");
      },
      session: {
        async getOrStart(key) {
          session.key = key;
          return session;
        },
      },
    };

    const result = await createCompany({
      projectRoot,
      companyName: "Session Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgent: ceoAgent,
      availableAgents: [ceoAgent],
      permissionMode: "balanced",
      assets: [],
      repositories,
      agentSessionEnv: { AUTO_CROP_EXPERIMENTAL_AGENT_SESSIONS: "1" },
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(session.key).toEqual({
      companyId: "company_1",
      agentId: "codex",
      permissionMode: "balanced",
    });
    expect(sessionRuns).toEqual(["company_1_ceo_blueprint"]);
    expect(result.company.permissionMode).toBe("balanced");

    client.close();
  });
});

function createTempProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "auto-crop-company-"));
  createdDirs.push(dir);
  return dir;
}

function createSequentialIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}
