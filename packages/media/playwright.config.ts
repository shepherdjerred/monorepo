import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const ci = Bun.env["CI"] === "true";

// The shared resolver picks a free port hashed from this checkout, so
// concurrent worktrees never collide. A package config cannot import root
// scripts, so it runs the resolver as a subprocess, as the other single-port
// Playwright configs do.
const harnessProbe = Bun.spawnSync(
  [
    process.execPath,
    fileURLToPath(
      new URL("../../scripts/lib/e2e/e2e-port.ts", import.meta.url),
    ),
    fileURLToPath(new URL("../..", import.meta.url)),
    "MEDIA_E2E_PORT",
  ],
  { env: Bun.env, stdout: "pipe", stderr: "pipe" },
);
if (harnessProbe.exitCode !== 0) {
  throw new Error(
    harnessProbe.stderr.toString() || "MEDIA_E2E_PORT probe failed",
  );
}
const [harnessPortText = "", harnessReuse = "0"] = harnessProbe.stdout
  .toString()
  .split(":");
const harnessPort = Number(harnessPortText);
// Playwright workers re-evaluate this file; they must read the same port.
Bun.env["_PLAYWRIGHT_RESOLVED_MEDIA_E2E_PORT"] = String(harnessPort);
const baseURL = `http://127.0.0.1:${String(harnessPort)}`;

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
  // A spec named `*.desktop.spec.ts` or `*.phone.spec.ts` tests something
  // only that layout has (the sidebar, the tab bar) and runs in that project
  // alone. Every other spec runs in both.
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
      testIgnore: /\.phone\.spec\.ts$/u,
    },
    {
      name: "mobile",
      // iPhone 13 is 390 CSS pixels wide.
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
      testIgnore: /\.desktop\.spec\.ts$/u,
    },
  ],
  webServer: {
    command: `bun run build && bun e2e/browser/server.ts ${String(harnessPort)}`,
    url: `${baseURL}/readyz`,
    timeout: 120_000,
    reuseExistingServer: harnessReuse === "1",
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
