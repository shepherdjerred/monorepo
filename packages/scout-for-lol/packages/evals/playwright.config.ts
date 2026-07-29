import { defineConfig, devices } from "@playwright/test";
import { env } from "node:process";

const isCI = env["CI"] === "true";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: 0,
  workers: 1,
  reporter: isCI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:7351",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run e2e/server.ts",
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:7351/health",
  },
});
