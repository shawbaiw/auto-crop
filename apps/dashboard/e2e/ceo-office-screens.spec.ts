import { expect, test, type Page } from "@playwright/test";
import { ceoOfficeCompany, mockCeoOfficeApi } from "./ceoOfficeFixture";
import { expectTokenRadii } from "./iceMistGuards";

/**
 * Screens of CEO Office for visual inspection, in both interface languages and at desktop and phone
 * width: each tab, an open dialog, and the "Needs you" section that folds on a phone. Every screen
 * is checked for horizontal scroll and for Retro UI left in the page.
 */
const viewports = [
  { height: 900, name: "desktop", width: 1440 },
  { height: 844, name: "mobile", width: 390 },
];

const labels = {
  en: { timeline: "Timeline", plan: "Plan", outcomes: "Outcomes", needsYou: /^Needs you · / , decide: "Open: Choose the pricing model", engineering: "Engineering" },
  zh: { timeline: "时间线", plan: "计划", outcomes: "成果", needsYou: /^需要你 · /, decide: "打开：Choose the pricing model", engineering: "工程部" },
};

for (const language of ["en", "zh"] as const) {
  for (const viewport of viewports) {
    test(`captures CEO Office on ${viewport.name} in ${language}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ height: viewport.height, width: viewport.width });
      await page.addInitScript((companyId) => window.localStorage.setItem("auto-crop.currentCompanyId", companyId), ceoOfficeCompany.id);
      await mockCeoOfficeApi(page);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (language === "zh") await page.getByRole("button", { name: "中文", exact: true }).click();
      const text = labels[language];
      const shot = async (name: string) => {
        // Let colour transitions finish, so a screen never shows two tabs half selected.
        await page.waitForTimeout(250);
        await expectModern(page);
        await page.screenshot({ path: testInfo.outputPath(`ceo-office-${name}-${viewport.name}-${language}.png`) });
      };

      await expect(page.getByRole("tab", { name: text.timeline })).toHaveAttribute("data-state", "active");
      await shot("timeline");
      // Earlier days open on demand.
      await page.locator("details summary").filter({ hasText: /2026/ }).last().click();
      await shot("timeline-earlier");

      if (viewport.name === "mobile") {
        await page.locator("summary").filter({ hasText: text.needsYou }).click();
        await shot("needs-you-open");
      }
      await page.getByRole("button", { name: text.decide }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot("decision-dialog");
      await page.keyboard.press("Escape");
      if (viewport.name === "mobile") await page.locator("summary").filter({ hasText: text.needsYou }).click();

      await page.getByRole("tab", { name: text.plan }).click();
      await expect(page.locator(".react-flow__node")).toHaveCount(6);
      await page.waitForTimeout(300);
      await shot("plan");

      await page.getByRole("tab", { name: text.outcomes }).click();
      await expect(page.getByRole("tab", { name: text.outcomes })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tab", { name: text.plan })).toHaveAttribute("aria-selected", "false");
      await shot("outcomes");

      // The department page: header, a running and a stopped trace, and its "Needs you".
      if (viewport.name === "mobile") await page.getByRole("button", { name: language === "zh" ? "打开导航" : "Open navigation" }).click();
      await page.getByRole("navigation").getByRole("button", { name: text.engineering, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: text.engineering })).toBeVisible();
      await shot("department");
      if (viewport.name === "mobile") {
        await page.locator("summary").filter({ hasText: text.needsYou }).click();
        await shot("department-needs-you-open");
      }
    });
  }
}

async function expectModern(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator("[class*='retro-'], [class*='videotex'], .theme-root, .legacy-workspace")).toHaveCount(0);
  await expectTokenRadii(page);
}
