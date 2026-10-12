import { defineConfig, devices } from "@playwright/test";
import { fixtureApiUrl } from "./e2e/fixtureApi";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:5175",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm --filter @auto-crop/dashboard dev --port 5175",
    env: { AUTO_CROP_API_PROXY: fixtureApiUrl },
    reuseExistingServer: !process.env.CI,
    url: "http://127.0.0.1:5175",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
