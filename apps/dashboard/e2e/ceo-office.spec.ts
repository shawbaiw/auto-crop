import { expect, test } from "@playwright/test";

test("CEO Office keeps a fixed viewport, follows new cards, and preserves history reading", async ({ page }, testInfo) => {
  let count = 30;
  const report = (index: number) => ({
    id: `report:${index}`, type: "execution_report", companyId: "c", sourceId: `${index}`, taskId: "t", departmentId: "d", objectiveId: null, keyResultId: null,
    occurredAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(), title: `Completed comparison ${index}`, titleText: { en: `Completed comparison ${index}` }, actionBearing: false,
    data: { conclusion: { en: `Result ${index}: the tested option satisfies the stated requirements.` }, workSummary: { en: "Compared candidates and checked the results." }, evidence: { en: "Recorded observations support the recommendation." }, visionImpact: null, remainingGap: null, recommendation: null, summaryFallback: null, businessArtifactId: null, remainingGaps: [], recommendedNextSteps: [], outcome: "accepted" },
  });
  await page.addInitScript(() => {
    localStorage.setItem("auto-crop.currentCompanyId", "c");
    class MockEvents extends EventTarget {
      constructor() {
        super();
        window.addEventListener("test-company-update", () => this.dispatchEvent(new MessageEvent("task_started", { data: JSON.stringify({ type: "task_started", companyId: "c", taskId: "t", status: "running" }) })));
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: MockEvents });
  });
  await page.route(/\/api\/(?:companies|agents|events)(?:\/|\?|$)/, async route => {
    const path = new URL(route.request().url()).pathname;
    const company = { id: "c", name: "Viewport Studio", status: "draft", playbookId: "custom", locale: "en", founderVision: "Compare options with evidence", selectedCeoAgentId: "agent" };
    const state = { company, departments: [{ id: "d", name: "Research", responsibility: "Compare options", leadAgentId: "agent" }], objectives: [], keyResults: [], tasks: [{ id: "t", title: "Compare options", status: "complete", departmentId: "d" }], ceoOfficeItems: Array.from({ length: count }, (_, index) => report(index)), proof: [], businessArtifacts: [], reviews: [], activity: [], replanProposals: [], taskProgressEvents: [], taskCompletionEvents: [], founderDecisions: [], humanActions: [], waitStates: [], visionGaps: [], ceoIntakes: [] };
    await route.fulfill({ json: path === "/api/agents" ? { agents: [{ id: "agent", name: "Agent", capabilities: [], detected: true }] } : path.endsWith("/state") ? state : { companies: [company] } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const history = page.locator(".ceo-intake-report__history");
  const input = page.locator(".ceo-intake-report__footer textarea");
  await expect(history).toBeVisible();
  await expect(input).toBeVisible();
  const metrics = () => page.evaluate(() => ({ documentHeight: document.documentElement.scrollHeight, viewport: innerHeight, historyHeight: document.querySelector(".ceo-intake-report__history")!.clientHeight }));
  await expect.poll(async () => (await metrics()).historyHeight).toBeGreaterThan(150);
  expect((await metrics()).documentHeight).toBeLessThanOrEqual(901);
  await expect.poll(() => history.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(2);
  count++;
  await page.evaluate(() => window.dispatchEvent(new Event("test-company-update")));
  await expect(page.getByText("Completed comparison 30", { exact: true })).toBeVisible();
  await expect.poll(() => history.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(2);
  await history.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event("scroll")); });
  count++;
  await page.evaluate(() => window.dispatchEvent(new Event("test-company-update")));
  await expect(page.getByRole("button", { name: /New messages/ })).toBeVisible();
  expect(await history.evaluate(node => node.scrollTop)).toBe(0);
  await page.getByRole("button", { name: /New messages/ }).click();
  await expect.poll(() => history.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(2);
  await page.screenshot({ path: testInfo.outputPath("ceo-office-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(input).toBeVisible();
  await expect.poll(async () => (await metrics()).historyHeight).toBeGreaterThan(80);
  expect((await metrics()).documentHeight).toBeLessThanOrEqual(845);
  await page.screenshot({ path: testInfo.outputPath("ceo-office-mobile.png") });
});
