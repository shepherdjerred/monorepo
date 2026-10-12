import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.WIKI_E2E_PORT ?? "4358");
if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65_535) {
  throw new Error("WIKI_E2E_PORT must be a valid TCP port");
}
const baseURL = `http://127.0.0.1:${PORT.toString()}`;
const isCI = process.env.CI !== undefined;
// Astro 7 detects agent environments and daemonizes preview automatically.
// Disable that behavior so Playwright owns the server process, observes startup
// failures, and tears it down with the test run.
// Keep an unrelated developer preview alive; this foreground server owns only
// Playwright's port and does not read or replace Astro's shared preview lock.
const previewCommand = `ASTRO_PREVIEW_BACKGROUND=0 bun run preview --ignore-lock --host 127.0.0.1 --port ${PORT.toString()}`;

export default defineConfig({
  fullyParallel: true,
  outputDir: "test-results",
  reporter: isCI
    ? [
        ["github"],
        ["html", { open: "never" }],
        [
          "junit",
          {
            outputFile:
              "../../../.ci-reports/junit/shepherdjerred__docs-wiki/playwright.xml",
          },
        ],
      ]
    : "list",
  retries: isCI ? 2 : 0,
  testDir: "./tests",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: previewCommand,
    // A server on this port may belong to another worktree. Always prove the
    // current build; parallel local checkouts can choose their own bootstrap port.
    reuseExistingServer: false,
    url: baseURL,
    // Playwright defaults to 60s, which the browser-E2E pod exceeds under load:
    // it runs several suites at --concurrency=2, so a server can be starved
    // well past a minute. 120s matches sjer.red, alert-dashboard, and evals.
    timeout: 120_000,
  },
});
