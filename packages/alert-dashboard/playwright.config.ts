import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const isCI = Bun.env["CI"] === "true";
const portProc = Bun.spawnSync(
  [
    process.execPath,
    fileURLToPath(
      new URL("../../scripts/lib/e2e/e2e-port.ts", import.meta.url),
    ),
    fileURLToPath(new URL("../..", import.meta.url)),
    "ALERT_DASHBOARD_E2E_PORT",
  ],
  { env: Bun.env, stdout: "pipe", stderr: "pipe" },
);
if (portProc.exitCode !== 0) {
  throw new Error(
    portProc.stderr.toString() || "ALERT_DASHBOARD_E2E_PORT probe failed",
  );
}
const [dashboardPortText = "", dashboardReuse = "0"] = portProc.stdout
  .toString()
  .split(":");
const dashboardPort = Number(dashboardPortText);
Bun.env["_PLAYWRIGHT_RESOLVED_ALERT_DASHBOARD_E2E_PORT"] =
  String(dashboardPort);
const baseURL = `http://127.0.0.1:${String(dashboardPort)}`;

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
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bun run build && cd ../.. && bun packages/alert-dashboard/e2e/server.ts ${String(dashboardPort)}`,
    url: `${baseURL}/healthz`,
    timeout: 120_000,
    reuseExistingServer: dashboardReuse === "1",
  },
});
