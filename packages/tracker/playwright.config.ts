import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { listenerCwd, selectE2ePort } from "./src/e2e-port.ts";

const checkout = path.resolve(import.meta.dir, "../..");
const ci = Bun.env["CI"] === "true";

function resolveCiTrackerPort(repoRoot: string): number {
  const resolver = path.join(repoRoot, "scripts/lib/e2e/e2e-port.ts");
  const out = Bun.spawnSync(
    [process.execPath, resolver, repoRoot, "TRACKER_E2E_PORT"],
    { env: Bun.env, stdout: "pipe", stderr: "pipe" },
  );
  if (out.exitCode !== 0) {
    throw new Error(out.stderr.toString() || "Failed to allocate Tracker port");
  }
  const selected = Number.parseInt(
    out.stdout.toString().split(":")[0] ?? "",
    10,
  );
  Bun.env["_PLAYWRIGHT_RESOLVED_TRACKER_E2E_PORT"] = String(selected);
  return selected;
}

const port = ci
  ? resolveCiTrackerPort(checkout)
  : selectE2ePort(checkout, false, listenerCwd);
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
      testIgnore: /\.desktop\.spec\.ts$/u,
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
