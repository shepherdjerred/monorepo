import { defineConfig, devices } from "@playwright/test";
import { env } from "node:process";

const isCI = env["CI"] === "true";

export default defineConfig({
  testDir: "./workbench",
  timeout: 60_000,
  forbidOnly: isCI,
  workers: isCI ? 3 : undefined,
  reporter: isCI
    ? [
        ["github"],
        [
          "junit",
          {
            outputFile:
              "../../../../.ci-reports/junit/scout-for-lol__design-system/playwright.xml",
          },
        ],
      ]
    : "list",
  outputDir: "./test-results",
  snapshotDir: "./workbench/__screenshots__",
  snapshotPathTemplate:
    "{snapshotDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}",
  webServer: {
    // Vite's persisted dependency optimizer can stall before binding when a
    // prior build populated this package's cache. The workbench is a test-only
    // server, so rebuild its optimizer state on every Playwright-owned start.
    command: "bun run dev --host 127.0.0.1 --port 5190 --force --strictPort",
    url: "http://127.0.0.1:5190",
    reuseExistingServer: true,
    // Playwright defaults to 60s. This vite server shares the browser-E2E pod
    // with sjer.red's 110-screenshot run at --concurrency=2 and timed out at
    // exactly 60s on build 10779 without emitting an error. 120s matches
    // sjer.red, alert-dashboard, and evals.
    timeout: 120_000,
  },
  use: { baseURL: "http://127.0.0.1:5190", reducedMotion: "reduce" },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], browserName: "chromium" },
    },
    {
      name: "firefox-desktop",
      use: { ...devices["Desktop Firefox"], browserName: "firefox" },
    },
    {
      name: "webkit-desktop",
      use: { ...devices["Desktop Safari"], browserName: "webkit" },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Galaxy S9+"], browserName: "chromium" },
    },
    {
      name: "firefox-mobile",
      use: { ...devices["Galaxy S9+"], browserName: "firefox" },
    },
    {
      name: "webkit-mobile",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
});
