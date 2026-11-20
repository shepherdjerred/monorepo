import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const checkout = fileURLToPath(new URL("../..", import.meta.url));
const portScript = fileURLToPath(
  new URL("../../scripts/lib/e2e/e2e-port.ts", import.meta.url),
);
const ci = Bun.env["CI"] === "true";

/** A free port hashed from this checkout, so concurrent worktrees never collide. */
function pickPort(envVar: string): {
  port: number;
  reuseExistingServer: boolean;
} {
  const proc = Bun.spawnSync([process.execPath, portScript, checkout, envVar], {
    env: Bun.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString() || `failed to resolve ${envVar}`);
  }
  const [portText = "", reuseFlag = "0"] = proc.stdout.toString().split(":");
  const port = Number(portText);
  Bun.env[`_PLAYWRIGHT_RESOLVED_${envVar}`] = String(port);
  return { port, reuseExistingServer: reuseFlag === "1" };
}

const server = pickPort("MEDIA_E2E_PORT");
const baseURL = `http://127.0.0.1:${String(server.port)}`;

export default defineConfig({
  // `e2e/` also holds the Docker and Plex system harnesses; only this
  // directory contains browser specs.
  testDir: "./e2e/browser",
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
              "../../.ci-reports/junit/shepherdjerred__media/playwright.xml",
          },
        ],
      ]
    : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile",
      // iPhone 13 is 390 CSS pixels wide.
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: `bun run build && bun e2e/browser/server.ts ${String(server.port)}`,
    url: `${baseURL}/readyz`,
    timeout: 120_000,
    reuseExistingServer: server.reuseExistingServer,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
