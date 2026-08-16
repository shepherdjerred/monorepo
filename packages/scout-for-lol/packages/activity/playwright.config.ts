import { defineConfig } from "@playwright/test";

const isCI = process.env["CI"] === "true";
const testDiscordClientId = ["123456789", "012345678"].join("");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
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
