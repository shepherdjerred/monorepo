import { defineConfig } from "@playwright/test";

const PORT = 4358;
const baseURL = `http://127.0.0.1:${PORT.toString()}`;
const isCI = process.env.CI !== undefined;
// Astro's preview command starts a background server and then exits. Keep the
// Playwright web-server parent alive, and stop that background server when
// Playwright tears the parent down so local runs never leave a stale preview.
const previewCommand = `sh -ec 'bun run preview --host 127.0.0.1 --port ${PORT.toString()}; trap "bunx --no-install astro preview stop" EXIT; tail -f /dev/null & wait $!'`;

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
    reuseExistingServer: !isCI,
    url: baseURL,
    // Playwright defaults to 60s, which the browser-E2E pod exceeds under load:
    // it runs several suites at --concurrency=2, so a server can be starved
    // well past a minute. 120s matches sjer.red, alert-dashboard, and evals.
    timeout: 120_000,
  },
});
