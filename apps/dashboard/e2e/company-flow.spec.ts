import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { Proof } from "@auto-crop/core";
import { fixtureApiPort } from "./fixtureApi";
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
  await page.goto("/");

  // No companies yet, so the dashboard opens straight into the onboarding wizard.
  await expect(page.getByRole("heading", { name: "CEO Office" })).toBeVisible();
  await page.getByLabel("Company name").fill("Pricing Page Studio");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: /codex/i }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Founder vision").fill("Build an AI SaaS that creates pricing pages.");
  await page.getByRole("radiogroup", { name: "Permission mode" }).getByRole("radio", { name: "Balanced" }).click();
  await page.getByRole("button", { name: /create company/i }).click();

  await expect(page.getByLabel("Founder vision")).toHaveCount(0);
  // The company runs as soon as its blueprint exists (ADR 0044) and opens on CEO Office.
  await expect(page.getByRole("heading", { name: "Pricing Page Studio" })).toBeVisible();
  await openMenuItem(page, "Work", "View Tasks");
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

  // The mock agent returns a text log, not the business artifact the product brief's proof schema
  // requires, so the runtime blocks that task. The dashboard must show it live over the event stream.
  await expect(page.getByText(/missing business artifact/i).first()).toBeVisible();
  await openMenuItem(page, "Proof", "Load Proof");
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

  await openMenuItem(page, "Proof", "Load Review");
  await expect(page.getByText("Completed 0 task(s), 0 missing proof.")).toBeVisible();

  await openMenuItem(page, "Company", "Pause Operating");
  await expect(page.getByText("This company is paused. No new work starts until you resume it.")).toBeVisible();
  expect(fixture.repositories.getCompany(companyId)?.status).toBe("paused");
});

async function openMenuItem(page: Page, menu: string, item: string) {
  await page.getByRole("menuitem", { name: menu, exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

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

  await new Promise<void>((resolve) => server.httpServer.listen(fixtureApiPort, "127.0.0.1", resolve));

  return {
    agents,
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
