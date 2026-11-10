import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { listenerCwd, selectE2ePort } from "./src/e2e-port.ts";

const checkout = path.resolve(import.meta.dir, "../..");
const ci = Bun.env["CI"] === "true";
const port = selectE2ePort(checkout, ci, (candidate) =>
  ci ? null : listenerCwd(candidate),
);
const baseURL = `http://127.0.0.1:${String(port)}`;

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
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: `bun e2e/server.ts ${String(port)}`,
    url: `${baseURL}/readyz`,
    timeout: 60_000,
    // The selected port is free or already belongs to this checkout.
    reuseExistingServer: !ci,
    // The server stops its private PostgreSQL cluster on SIGTERM; the default
    // SIGKILL would orphan one cluster per run.
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
  },
});
