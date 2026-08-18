import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMockAgentAdapter } from "../adapters/mockAgent";
import type { AgentAdapter } from "../adapters/types";
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

    expect(result.editable.companyName).toBe("Pricing Page Studio");
    expect(result.company.name).toBe("Pricing Page Studio");
    expect(result.editable.objectives).toEqual(["Validate the first AI SaaS wedge"]);
    expect(result.editable.firstTasks.length).toBeGreaterThan(0);
    expect(result.company.playbookId).toBe("ai-saas");
    expect(result.company.status).toBe("draft");

    expect(repositories.getCompany(result.company.id)?.name).toBe("Pricing Page Studio");
    expect(repositories.listDepartments(result.company.id).map((department) => department.name)).toEqual([
      "Product",
      "Research",
      "Growth",
      "Engineering",
    ]);
    expect(repositories.listObjectives(result.company.id)).toHaveLength(1);
    expect(repositories.listKeyResults(result.company.id)).toHaveLength(2);
    expect(repositories.fetchQueuedTasks(10).length).toBeGreaterThan(0);

    const engineering = repositories
      .listDepartments(result.company.id)
      .find((department) => department.name === "Engineering");
    expect(engineering).toBeDefined();
    expect(existsSync(engineering?.memoryPath ?? "")).toBe(true);

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
