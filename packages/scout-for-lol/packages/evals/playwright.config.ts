import { defineConfig, devices } from "@playwright/test";
import { env } from "node:process";

const isCI = env["CI"] === "true";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: isCI,
  // The suite shares one in-memory store across tests on a single worker, so
  // Playwright retries are unsafe here — a retried mutating test would re-run
  // against dirty state (see packages/scout-for-lol/AGENTS.md). Instead of
  // retries, give assertions generous headroom: on a CPU-constrained CI agent
  // (the playwright pod requests 2 CPUs and runs test:e2e concurrently with the
  // unit tests + lint), React mount after a full-page navigation can lag past
  // the 5s default, especially on the last of several sequential `page.goto`s
  // in one test. This keeps assertions strict while tolerating slow mounts.
  retries: 0,
  workers: 1,
  expect: { timeout: 15_000 },
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
