import { defineConfig, devices } from "@playwright/test";
import { env } from "node:process";

const isCI = env["CI"] === "true";

export default defineConfig({
  testDir: "./workbench",
  timeout: 60_000,
  forbidOnly: isCI,
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
    command: "bun run dev --host 127.0.0.1",
    url: "http://127.0.0.1:5190",
    reuseExistingServer: true,
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
