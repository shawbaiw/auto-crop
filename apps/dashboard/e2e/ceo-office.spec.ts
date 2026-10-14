import { expect, test } from "@playwright/test";
import { ceoOfficeCompany, mockCeoOfficeApi } from "./ceoOfficeFixture";

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
    const company = { id: "c", name: "Viewport Studio", status: "active", playbookId: "custom", locale: "en", founderVision: "Compare options with evidence", selectedCeoAgentId: "agent" };
    const state = { company, departments: [{ id: "d", name: "Research", responsibility: "Compare options", leadAgentId: "agent" }], objectives: [], keyResults: [], tasks: [{ id: "t", title: "Compare options", status: "complete", departmentId: "d" }], ceoOfficeItems: Array.from({ length: count }, (_, index) => report(index)), proof: [], businessArtifacts: [], reviews: [], activity: [], replanProposals: [], taskProgressEvents: [], taskCompletionEvents: [], founderDecisions: [], humanActions: [], waitStates: [], visionGaps: [], ceoIntakes: [] };
    await route.fulfill({ json: path === "/api/agents" ? { agents: [{ id: "agent", name: "Agent", capabilities: [], detected: true }] } : path.endsWith("/state") ? state : { companies: [company] } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const history = page.getByRole("region", { name: "Timeline" });
  const input = page.getByRole("textbox", { name: "Message to the CEO" });
  await expect(history).toBeVisible();
  await expect(input).toBeVisible();
  const metrics = async () => ({
    ...(await page.evaluate(() => ({ documentHeight: document.documentElement.scrollHeight, viewport: innerHeight }))),
    historyHeight: await history.evaluate(node => node.clientHeight),
  });
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
  await expect(page.getByRole("button", { name: /New updates/ })).toBeVisible();
  expect(await history.evaluate(node => node.scrollTop)).toBe(0);
  await page.getByRole("button", { name: /New updates/ }).click();
  await expect.poll(() => history.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(2);
  // Three columns: the timeline and composer in the centre, "Needs you" on the right.
  const needsYou = page.getByRole("complementary", { name: "Needs you" });
  await expect(needsYou).toBeVisible();
  const [centre, right] = await Promise.all([history.boundingBox(), needsYou.boundingBox()]);
  expect(right!.x).toBeGreaterThan(centre!.x + centre!.width - 1);
  const composer = await input.boundingBox();
  expect(composer!.y).toBeGreaterThan(centre!.y + centre!.height - 1);
  await page.screenshot({ path: testInfo.outputPath("ceo-office-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(input).toBeVisible();
  // On a phone "Needs you" folds into a section above the timeline.
  await expect(page.getByRole("complementary", { name: "Needs you" })).toHaveCount(0);
  await expect(page.locator("summary").filter({ hasText: /^Needs you · 0/ })).toBeVisible();
  await expect.poll(async () => (await metrics()).historyHeight).toBeGreaterThan(80);
  expect((await metrics()).documentHeight).toBeLessThanOrEqual(845);
  await page.screenshot({ path: testInfo.outputPath("ceo-office-mobile.png") });
});

test("the Plan tab scrolls inside its own area on a short phone screen, so the composer never covers the plan", async ({ page }) => {
  await page.addInitScript((id) => localStorage.setItem("auto-crop.currentCompanyId", id), ceoOfficeCompany.id);
  await mockCeoOfficeApi(page);
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Plan" }).click();
  const composerTop = async () => (await page.getByRole("textbox", { name: "Message to the CEO" }).boundingBox())!.y;
  // Goals, canvas and legend are taller than the tab here: the tab ends above the composer and scrolls on its own.
  const tab = (await page.getByRole("tabpanel", { name: "Plan" }).boundingBox())!;
  expect(tab.y + tab.height).toBeLessThanOrEqual(await composerTop());
  const legend = page.getByRole("list", { name: "Departments" });
  await legend.scrollIntoViewIfNeeded();
  const box = (await legend.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(await composerTop());
});
