import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const ci = Bun.env["CI"] === "true";
const checkout = path.resolve(import.meta.dir, "../..");
const portKey = "TASKNOTES_WEB_E2E_PORT";
const allocatedKey = "_PLAYWRIGHT_RESOLVED_TASKNOTES_WEB_E2E_PORT";
const selected = Bun.spawnSync(
  [
    process.execPath,
    path.join(checkout, "scripts/lib/e2e/e2e-port.ts"),
    checkout,
    portKey,
  ],
  { stdout: "pipe", stderr: "inherit" },
);
if (!selected.success)
  throw new Error("Could not allocate a port for Facet browser tests.");
const [port, reusable] = selected.stdout.toString().split(":");
if (port === undefined)
  throw new Error("The browser tests require a Facet port.");
Bun.env[allocatedKey] = port;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
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
              "../../.ci-reports/junit/shepherdjerred__tasknotes-web/playwright.xml",
          },
        ],
      ]
    : "list",
  use: { baseURL, trace: "retain-on-failure", actionTimeout: 8000 },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "phone", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: `bun run build && bun e2e/server.ts ${port}`,
    url: `${baseURL}/api/health`,
    timeout: 60_000,
    reuseExistingServer: reusable === "1",
  },
});
