import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const ci = Bun.env["CI"] === "true";
const portProc = Bun.spawnSync(
  [
    process.execPath,
    fileURLToPath(
      new URL("../../scripts/lib/e2e/e2e-port.ts", import.meta.url),
    ),
    fileURLToPath(new URL("../..", import.meta.url)),
    "ARTIFACTS_E2E_PORT",
  ],
  { env: Bun.env, stdout: "pipe", stderr: "pipe" },
);
if (portProc.exitCode !== 0) {
  throw new Error(
    portProc.stderr.toString() || "ARTIFACTS_E2E_PORT probe failed",
  );
}
const [portText = "", reuse = "0"] = portProc.stdout.toString().split(":");
const port = Number(portText);
Bun.env["_PLAYWRIGHT_RESOLVED_ARTIFACTS_E2E_PORT"] = String(port);
const baseURL = `http://127.0.0.1:${String(port)}`;
const desktopViewport = { width: 1440, height: 900 };

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
              "../../.ci-reports/junit/shepherdjerred__artifacts/playwright.xml",
          },
        ],
      ]
    : "list",
  // CI only needs a trace for the retry of a failed test; passing runs write none.
  use: { baseURL, trace: ci ? "on-first-retry" : "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: desktopViewport },
      grepInvert: /@phone/u,
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
      testIgnore: /(?:\.desktop|server)\.spec\.ts$/u,
      // Tests tagged @desktop assert the wide layout.
      grepInvert: /@desktop/u,
    },
    // Playwright's bundled Firefox does not launch on this macOS, so WebKit is
    // the second desktop engine.
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: desktopViewport },
      testIgnore: /server\.spec\.ts$/u,
      grepInvert: /@phone/u,
    },
  ],
  webServer: {
    command: `bun e2e/server.ts ${String(port)}`,
    url: `${baseURL}/readyz`,
    timeout: 60_000,
    reuseExistingServer: reuse === "1",
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
  },
});
