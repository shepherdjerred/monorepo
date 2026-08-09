import { defineConfig, devices } from "@playwright/test";

const isCI = process.env["CI"] === "true";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 2,
  reporter: isCI
    ? [
        ["list"],
        [
          "junit",
          {
            outputFile:
              "../../.ci-reports/junit/shepherdjerred__alert-dashboard/playwright.xml",
          },
        ],
      ]
    : "list",
  use: { baseURL: "http://127.0.0.1:17341", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "bun run build && cd ../.. && bun packages/alert-dashboard/e2e/server.ts",
    url: "http://127.0.0.1:17341/healthz",
    timeout: 120_000,
    reuseExistingServer: !isCI,
  },
});
