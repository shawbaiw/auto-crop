import { inflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";

const skinIds = ["mono", "classic", "powder", "geek01", "geek02", "retro01", "retro02", "game01", "game02"];
const viewports = [
  { height: 900, name: "desktop", width: 1440 },
  { height: 844, name: "mobile", width: 390 },
];

const company = {
  id: "company_visual",
  name: "Pricing Page Studio",
  status: "draft",
  playbookId: "ai-saas",
  locale: "en",
  founderVision: "Build an AI SaaS that creates pricing pages.",
  selectedCeoAgentId: "codex",
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
  taskCount: 3,
};

for (const viewport of viewports) {
  test(`captures modern company picker screenshots on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    await mockApi(page, { companies: [company] });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Pricing Page Studio/ })).toBeVisible();
    await expectModernPage(page);

    await page.screenshot({ fullPage: true, path: testInfo.outputPath(`modern-company-picker-${viewport.name}.png`) });
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

  // Company flow pages are modern; the Department Workspace is still legacy, so CRT coverage enters there.
  test(`captures CRT visual regression screenshots for every skin on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });

    for (const skinId of skinIds) {
      await openLegacyWorkspace(page, `/?skin=${skinId}&crt=full`);

      const screenshot = await page.locator(".crt-screen-face").screenshot({
        path: testInfo.outputPath(`crt-${skinId}-${viewport.name}.png`),
      });
      expect(renderedContrastRatio(screenshot)).toBeGreaterThan(2.2);
    }
  });
}

test("measures CRT full-quality frame cost", async ({ page }) => {
  await openLegacyWorkspace(page, "/?skin=mono&crt=full");

  const frameMetrics = await page.evaluate(
    () =>
      new Promise<{ averageFrameMs: number; maxFrameMs: number }>((resolve) => {
        const frameIntervals: number[] = [];
        let previousTimestamp: number | null = null;

        function measure(timestamp: number) {
          if (previousTimestamp !== null) {
            frameIntervals.push(timestamp - previousTimestamp);
          }
          previousTimestamp = timestamp;

          if (frameIntervals.length >= 30) {
            resolve({
              averageFrameMs: frameIntervals.reduce((sum, frameMs) => sum + frameMs, 0) / frameIntervals.length,
              maxFrameMs: Math.max(...frameIntervals),
            });
            return;
          }

          requestAnimationFrame(measure);
        }

        requestAnimationFrame(measure);
      }),
  );

  expect(frameMetrics.averageFrameMs).toBeLessThan(50);
  expect(frameMetrics.maxFrameMs).toBeLessThan(120);
});

async function expectModernPage(page: Page) {
  await expect(page.locator(".crt-viewport")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function openLegacyWorkspace(page: Page, url: string) {
  await page.addInitScript((companyId) => window.localStorage.setItem("auto-crop.currentCompanyId", companyId), company.id);
  await mockApi(page, { companies: [company] });
  await page.goto(url);
  await expect(page.locator(".crt-screen-face")).toBeVisible();
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
    objectives: [],
    keyResults: [],
    tasks: [],
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
      } else if (path.endsWith("/state")) {
        await route.fulfill({ json: state });
      } else {
        await route.fulfill({ json: { companies } });
      }
    },
  );
}

function renderedContrastRatio(png: Buffer) {
  const pixels = parsePngRgb(png);
  const luminanceSamples: number[] = [];
  const sampleStride = Math.max(1, Math.floor(pixels.width / 90));

  for (let y = 0; y < pixels.height; y += sampleStride) {
    for (let x = 0; x < pixels.width; x += sampleStride) {
      const offset = (y * pixels.width + x) * 3;
      luminanceSamples.push(relativeLuminance(pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]));
    }
  }

  luminanceSamples.sort((a, b) => a - b);
  const dark = luminanceSamples[Math.floor(luminanceSamples.length * 0.05)];
  const light = luminanceSamples[Math.floor(luminanceSamples.length * 0.95)];
  return (light + 0.05) / (dark + 0.05);
}

function parsePngRgb(png: Buffer) {
  const signature = png.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error("Invalid PNG signature.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`Unsupported PNG format: bitDepth=${bitDepth} colorType=${colorType}`);
      }
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const rowBytes = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const rgb = Buffer.alloc(width * height * 3);
  let sourceOffset = 0;
  let previousRow = Buffer.alloc(rowBytes);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const currentRow = Buffer.from(inflated.subarray(sourceOffset, sourceOffset + rowBytes));
    sourceOffset += rowBytes;
    unfilterRow(currentRow, previousRow, bytesPerPixel, filter);

    for (let x = 0; x < width; x += 1) {
      const source = x * bytesPerPixel;
      const target = (y * width + x) * 3;
      rgb[target] = currentRow[source];
      rgb[target + 1] = currentRow[source + 1];
      rgb[target + 2] = currentRow[source + 2];
    }

    previousRow = currentRow;
  }

  return { data: rgb, height, width };
}

function unfilterRow(row: Buffer, previousRow: Buffer, bytesPerPixel: number, filter: number) {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previousRow[index] ?? 0;
    const upLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] : 0;

    if (filter === 1) {
      row[index] = (row[index] + left) & 0xff;
    } else if (filter === 2) {
      row[index] = (row[index] + up) & 0xff;
    } else if (filter === 3) {
      row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff;
    } else if (filter === 4) {
      row[index] = (row[index] + paethPredictor(left, up, upLeft)) & 0xff;
    } else if (filter !== 0) {
      throw new Error(`Unsupported PNG filter: ${filter}`);
    }
  }
}

function paethPredictor(left: number, up: number, upLeft: number) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  return upDistance <= upLeftDistance ? up : upLeft;
}

function relativeLuminance(red: number, green: number, blue: number) {
  const [linearRed, linearGreen, linearBlue] = [red, green, blue].map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * linearRed + 0.7152 * linearGreen + 0.0722 * linearBlue;
}
