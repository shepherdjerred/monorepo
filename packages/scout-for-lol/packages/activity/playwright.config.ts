import { defineConfig } from "@playwright/test";

const isCI = process.env["CI"] === "true";
const testDiscordClientId = ["123456789", "012345678"].join("");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  // Playwright derives its default worker count from os.cpus(), which reports
  // the *node's* CPUs, not the container's cgroup limit — on the CI node that
  // spawned 16 Chromium workers against a single Vite dev server in a pod
  // limited to 4 CPUs, while turbo ran a second package task alongside it.
  // The starved workers exceeded the 30s test timeout on plain navigation
  // (page.reload / goto), so tests failed on contention rather than content.
  // Cap to the pod's usable share; the suite is independent per test, so this
  // costs wall time and nothing else.
  workers: isCI ? 2 : "50%",
  forbidOnly: isCI,
  reporter: isCI
    ? [
        ["list"],
        [
          "junit",
          {
            outputFile:
              "../../../../.ci-reports/junit/scout-for-lol__activity/playwright.xml",
          },
        ],
      ]
    : "list",
  snapshotDir: "./e2e",
  snapshotPathTemplate: "{snapshotDir}/{testFilePath}-snapshots/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:5181/customs/",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `VITE_DISCORD_CLIENT_ID=${testDiscordClientId} bun run dev -- --host 127.0.0.1`,
    url: "http://127.0.0.1:5181/customs/",
    reuseExistingServer: !isCI,
  },
});
