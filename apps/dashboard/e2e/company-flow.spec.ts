import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Proof } from "@auto-crop/core";
import {
  aiSaasPlaybook,
  createApiServer,
  createDatabaseClient,
  createMockAgentAdapter,
  createRepositories,
  migrate,
  runCompanyReview,
  runSchedulerOnce,
} from "@auto-crop/server";

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;

test.beforeAll(async () => {
  fixture = await startFixtureServer();
});

test.afterAll(async () => {
  await fixture.close();
});

test("creates and operates a mock agent company through the dashboard", async ({ page }) => {
  await page.goto(`/?apiUrl=${encodeURIComponent(fixture.baseUrl)}`);

  await expect(page.getByRole("heading", { name: "CEO Office" })).toBeVisible();
  await page.getByRole("button", { name: /codex/i }).click();
  await page.getByLabel("Founder vision").fill("Build an AI SaaS that creates pricing pages.");
  await page.getByRole("button", { name: /permission mode/i }).click();
  await page.getByRole("option", { name: "Balanced" }).click();
  await page.getByRole("button", { name: /create company/i }).click();

  await expect(page.getByText("Pricing Page Studio")).toBeVisible();
  await expect(page.getByText("Validate the first AI SaaS wedge")).toBeVisible();
  await page.getByRole("button", { name: /activate company/i }).click();
  await expect(page.getByRole("heading", { name: "Company Operating Dashboard" })).toBeVisible();

  const companyId = fixture.repositories.fetchQueuedTasks(1)[0]?.companyId;
  await runSchedulerOnce({
    projectRoot: fixture.projectRoot,
    repositories: fixture.repositories,
    adapters: fixture.agents,
    workerId: "e2e-worker",
    maxTasks: 1,
    approvalRequired: () => false,
    proofCollector: ({ task, stdout }) => [
      {
        id: "proof_e2e_1",
        taskId: task.id,
        type: "command_output",
        uri: "agent.log",
        summary: stdout,
        verifiedAt: null,
      } satisfies Proof,
    ],
    emit: (event) => fixture.events.publish(event),
  });

  await expect(page.getByText("Task is ready for review.")).toBeVisible();
  await page.getByRole("button", { name: /load proof/i }).click();
  await expect(page.getByText("agent.log")).toBeVisible();

  if (!companyId) {
    throw new Error("Missing created company.");
  }

  runCompanyReview({
    projectRoot: fixture.projectRoot,
    companyId,
    repositories: fixture.repositories,
    now: () => new Date("2026-08-17T00:00:00.000Z"),
    createId: () => "review_e2e_1",
  });

  await page.getByRole("button", { name: /load review/i }).click();
  await expect(page.getByText("Completed 1 task(s), 0 missing proof.")).toBeVisible();

  await page.getByRole("button", { name: /kill switch/i }).click();
  await expect(page.getByText("Global pause active")).toBeVisible();
  await expect(page.locator(".page-header").getByText("review")).toBeVisible();
});

async function startFixtureServer() {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-dashboard-e2e-"));
  const database = createDatabaseClient(":memory:");
  migrate(database);
  const repositories = createRepositories(database);
  const blueprint = aiSaasPlaybook.createBlueprint({
    companyName: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    preferredEngineeringAgentId: "codex",
    preferredStrategyAgentId: "codex",
  });
  const agents = [
    createMockAgentAdapter({
      id: "codex",
      name: "Codex",
      capabilities: ["code", "frontend", "test"],
      output: ["## Human CEO Brief", "Validate.", "```json", JSON.stringify({ brief: "Validate.", blueprint }), "```"].join("\n"),
    }),
  ];
  const server = createApiServer({
    projectRoot,
    repositories,
    agents,
    now: () => new Date("2026-08-17T00:00:00.000Z"),
    createId: createSequentialIdFactory(),
  });

  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address() as AddressInfo;

  return {
    agents,
    baseUrl: `http://127.0.0.1:${address.port}`,
    events: server.events,
    projectRoot,
    repositories,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      database.close();
      rmSync(projectRoot, { recursive: true, force: true });
    },
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
