import { defineConfig, devices } from "@playwright/test";

const ci = Bun.env["CI"] === "true";
const MODEL_SPECS = /model\.spec\.ts$/u;
const MODEL_ORIGIN = "http://127.0.0.1:17355";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: 1,
  reporter: ci
    ? [
        ["list"],
        [
          "junit",
          {
            outputFile:
              "../../.ci-reports/junit/shepherdjerred__delivery/playwright.xml",
          },
        ],
      ]
    : "list",
  use: { baseURL: "http://127.0.0.1:17353", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      testIgnore: MODEL_SPECS,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testIgnore: MODEL_SPECS,
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
    // The model specs read their own harness: a catalog-owned database seeded
    // through Delivery's own APIs by e2e/model-server.ts.
    {
      name: "model-desktop",
      testMatch: MODEL_SPECS,
      use: { ...devices["Desktop Chrome"], baseURL: MODEL_ORIGIN },
    },
    {
      name: "model-mobile",
      testMatch: MODEL_SPECS,
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        baseURL: MODEL_ORIGIN,
      },
    },
  ],
  webServer: [
    {
      command: "bun run build && bun e2e/server.ts",
      url: "http://127.0.0.1:17353/readyz",
      timeout: 120_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
    {
      command: "bun e2e/model-server.ts",
      url: `${MODEL_ORIGIN}/readyz`,
      timeout: 120_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
  ],
});
