import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { height: 900, name: "desktop", width: 1440 },
  { height: 844, name: "mobile", width: 390 },
];

const company = {
  id: "company_visual",
  name: "Pricing Page Studio",
  status: "active",
  playbookId: "ai-saas",
  locale: "en",
  founderVision: "Build an AI SaaS that creates pricing pages.",
  selectedCeoAgentId: "codex",
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
  taskCount: 3,
};

for (const viewport of viewports) {
  // Every Workbench page is modern; no Retro UI is left (dashboard ADR 0002).
  test(`captures Workbench screenshots for every page on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    await page.addInitScript((companyId) => window.localStorage.setItem("auto-crop.currentCompanyId", companyId), company.id);
    await mockApi(page, { companies: [company] });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "CEO Office" })).toBeVisible();

    const pages = [
      { name: "CEO Office", file: "ceo-office", modernContent: true },
      { name: "Product", file: "department", modernContent: true },
      { name: "Operations Diagnostics", file: "operations-diagnostics", modernContent: true },
      { name: "Deliverables", file: "deliverables", modernContent: true },
      { name: "Settings", file: "settings", modernContent: true },
    ];
    for (const workbenchPage of pages) {
      if (viewport.name === "mobile") {
        await page.getByRole("button", { name: "Open navigation" }).click();
      }
      await page.getByRole("navigation", { name: "Workbench" }).getByRole("button", { name: workbenchPage.name, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: workbenchPage.name })).toBeVisible();
      await expectModernPage(page);
      if (workbenchPage.modernContent) {
        await expect(page.locator("[class*='retro-']")).toHaveCount(0);
      }
      await page.screenshot({ fullPage: true, path: testInfo.outputPath(`workbench-${workbenchPage.file}-${viewport.name}.png`) });
    }
  });

  test(`captures modern onboarding screenshots for every step on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    await mockApi(page, { companies: [] });
    await page.goto("/");

    await expect(page.getByLabel("Company name")).toBeVisible();
    await expectModernPage(page);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath(`modern-onboarding-company-${viewport.name}.png`) });

    await page.getByLabel("Company name").fill("Pricing Page Studio");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("button", { name: /Codex/ })).toBeVisible();
    await expectModernPage(page);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath(`modern-onboarding-agents-${viewport.name}.png`) });

    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Founder vision").fill("Build an AI SaaS that creates pricing pages.");
    await expectModernPage(page);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath(`modern-onboarding-vision-${viewport.name}.png`) });
  });

  test(`captures modern creation loading screenshots on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });

    for (const outcome of ["creating", "creation_failed"] as const) {
      await page.addInitScript((companyId) => window.localStorage.setItem("auto-crop.currentCompanyId", companyId), company.id);
      await mockApi(page, {
        companies: [company],
        company: { ...company, status: outcome, permissionMode: "balanced" },
        creationEvents: [
          creationEvent("company_creation_accepted", "Company Creation accepted.", "creating"),
          creationEvent("company_creation_agent_started", "CEO agent started drafting the blueprint.", "creating"),
          ...(outcome === "creation_failed"
            ? [creationEvent("company_creation_failed", "Company Creation failed: temporary model failure", outcome)]
            : []),
        ],
      });
      await page.goto("/");

      await expect(page.getByRole("region", { name: "Creation Stages" })).toBeVisible();
      await expectModernPage(page);
      await page.screenshot({ fullPage: true, path: testInfo.outputPath(`modern-${outcome}-${viewport.name}.png`) });
    }
  });

}

async function expectModernPage(page: Page) {
  await expect(page.locator(".crt-viewport")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Serves just enough of the API for a page to render, without a server or a live event stream. */
function creationEvent(type: string, message: string, status: string) {
  return { type, companyId: company.id, message, status };
}

async function mockApi(
  page: Page,
  {
    companies,
    company: stateCompany = company,
    creationEvents = [],
  }: { companies: (typeof company)[]; company?: typeof company & { permissionMode?: string }; creationEvents?: unknown[] },
) {
  const state = {
    company: stateCompany,
    creationEvents,
    departments: [{ id: "dept_product", name: "Product", responsibility: "Define the first wedge.", leadAgentId: "codex" }],
    objectives: [{ id: "objective_1", title: "Validate the first wedge", priority: 1 }],
    keyResults: [],
    tasks: [
      { id: "task_1", title: "Draft the pricing page brief", status: "running", departmentId: "dept_product", assigneeAgentId: "codex" },
      { id: "task_2", title: "Check the brief against the vision", status: "blocked", departmentId: "dept_product", failureReason: "timeout", effectiveTimeoutMs: 600_000 },
    ],
    ceoOfficeItems: [],
    proof: [],
    businessArtifacts: [],
    reviews: [],
    activity: [],
    replanProposals: [],
    taskProgressEvents: [],
    taskCompletionEvents: [],
    founderDecisions: [],
    humanActions: [],
    waitStates: [],
    visionGaps: [],
    ceoIntakes: [],
  };
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/events") {
        await route.abort();
      } else if (path === "/api/agents") {
        await route.fulfill({ json: { agents: [{ id: "codex", name: "Codex", capabilities: ["code"], detected: true }] } });
      } else if (path.endsWith("/execution")) {
        await route.fulfill({ json: { task: state.tasks.find((task) => path.includes(`/${task.id}/`)) } });
      } else if (path.endsWith("/state")) {
        await route.fulfill({ json: state });
      } else {
        await route.fulfill({ json: { companies } });
      }
    },
  );
}
