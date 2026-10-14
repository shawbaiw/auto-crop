import { expect, type Page } from "@playwright/test";

/**
 * Radii come only from the Ice Mist variables (spec §0.3): `rounded-[var(--r-*)]`. Tailwind's scale
 * (`rounded`, `rounded-md`, `rounded-full`, `rounded-t-lg` …) must not appear on any rendered element.
 */
export async function expectTokenRadii(page: Page) {
  const offenders = await page.evaluate(() =>
    [...document.querySelectorAll("[class*='rounded']")]
      .flatMap((element) => (element.getAttribute("class") ?? "").split(/\s+/))
      .filter((name) => /(^|:)rounded(-[a-z]{1,2})?(-(sm|md|lg|xl|2xl|3xl|full))?$/.test(name)),
  );
  expect(offenders).toEqual([]);
}
