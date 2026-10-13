import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Bun.env["CI"] === "true",
  retries: Bun.env["CI"] === "true" ? 1 : 0,
  workers: 1,
  reporter:
    Bun.env["CI"] === "true"
      ? [
          ["list"],
          [
            "junit",
            {
              outputFile:
                "../../.ci-reports/junit/shepherdjerred__tracker/playwright.xml",
            },
          ],
        ]
      : "list",
  use: { baseURL: "http://127.0.0.1:17351", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "bun e2e/server.ts",
    url: "http://127.0.0.1:17351/readyz",
    timeout: 60_000,
    reuseExistingServer: Bun.env["CI"] !== "true",
  },
});
