import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const checkout = fileURLToPath(new URL("../..", import.meta.url));
const portScript = fileURLToPath(
  new URL("../../scripts/lib/e2e/e2e-port.ts", import.meta.url),
);
const ci = Bun.env["CI"] === "true";

function pickPort(
  envVar: string,
  excluded: readonly number[] = [],
): { port: number; reuseExistingServer: boolean } {
  const proc = Bun.spawnSync(
    [process.execPath, portScript, checkout, envVar, ...excluded.map(String)],
    { env: Bun.env, stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString() || `failed to resolve ${envVar}`);
  }
  const [portText = "", reuseFlag = "0"] = proc.stdout.toString().split(":");
  const port = Number(portText);
  Bun.env[`_PLAYWRIGHT_RESOLVED_${envVar}`] = String(port);
  return { port, reuseExistingServer: reuseFlag === "1" };
}

const mainServer = pickPort("DELIVERY_E2E_PORT");
const modelServer = pickPort("DELIVERY_MODEL_E2E_PORT", [mainServer.port]);
const baseURL = `http://127.0.0.1:${String(mainServer.port)}`;
const MODEL_SPECS = /model\.spec\.ts$/u;
const MODEL_ORIGIN = `http://127.0.0.1:${String(modelServer.port)}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
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
              "../../.ci-reports/junit/shepherdjerred__delivery/playwright.xml",
          },
        ],
      ]
    : "list",
  // CI only needs a trace for the retry of a failed test; passing runs write none.
  use: { baseURL, trace: ci ? "on-first-retry" : "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      testIgnore: MODEL_SPECS,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testIgnore: MODEL_SPECS,
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
    // The model specs read their own harness: a catalog-owned database seeded
    // through Delivery's own APIs by e2e/model-server.ts.
    {
      name: "model-desktop",
      testMatch: MODEL_SPECS,
      use: { ...devices["Desktop Chrome"], baseURL: MODEL_ORIGIN },
    },
    {
      name: "model-mobile",
      testMatch: MODEL_SPECS,
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        baseURL: MODEL_ORIGIN,
      },
    },
  ],
  webServer: [
    {
      command: `bun run build && bun e2e/server.ts ${String(mainServer.port)}`,
      url: `${baseURL}/readyz`,
      timeout: 120_000,
      reuseExistingServer: mainServer.reuseExistingServer,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
    {
      command: `bun e2e/model-server.ts ${String(modelServer.port)}`,
      url: `${MODEL_ORIGIN}/readyz`,
      timeout: 120_000,
      reuseExistingServer: modelServer.reuseExistingServer,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
  ],
});
