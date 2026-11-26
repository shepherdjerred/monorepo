import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { listenerCwd, selectE2ePort } from "./e2e/e2e-port.ts";

const checkout = path.resolve(import.meta.dir, "../..");
const ci = Bun.env["CI"] === "true";

function resolveCiPort(repoRoot: string): number {
  const resolver = path.join(repoRoot, "scripts/lib/e2e/e2e-port.ts");
  const out = Bun.spawnSync(
    [process.execPath, resolver, repoRoot, "ARTIFACTS_E2E_PORT"],
    { env: Bun.env, stdout: "pipe", stderr: "pipe" },
  );
  if (out.exitCode !== 0) {
    throw new Error(
      out.stderr.toString() || "Failed to allocate Artifacts port",
    );
  }
  const selected = Number.parseInt(
    out.stdout.toString().split(":")[0] ?? "",
    10,
  );
  Bun.env["_PLAYWRIGHT_RESOLVED_ARTIFACTS_E2E_PORT"] = String(selected);
  return selected;
}

const port = ci
  ? resolveCiPort(checkout)
  : selectE2ePort(checkout, false, listenerCwd);
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
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: desktopViewport },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
      testIgnore: /(?:\.desktop|server)\.spec\.ts$/u,
    },
    // Playwright's bundled Firefox does not launch on this macOS, so WebKit is
    // the second desktop engine.
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: desktopViewport },
      testIgnore: /server\.spec\.ts$/u,
    },
  ],
  webServer: {
    command: `bun e2e/server.ts ${String(port)}`,
    url: `${baseURL}/readyz`,
    timeout: 60_000,
    // The selected port is free or already belongs to this checkout.
    reuseExistingServer: !ci,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
  },
});
