import { defineConfig, devices } from "@playwright/test";
import { env } from "node:process";
import { storybookCiReporter } from "@scout-for-lol/design-system/storybook/e2e";

const isCI = env["CI"] === "true";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  forbidOnly: isCI,
  // Omitted rather than set to undefined so Playwright keeps its own default
  // locally; exactOptionalPropertyTypes rejects the explicit undefined.
  ...(isCI ? { workers: 3 } : {}),
  reporter: isCI ? storybookCiReporter("scout-for-lol__app") : "list",
  outputDir: "./test-results",
  webServer: {
    // A static server over the already-built catalog. `test:e2e` depends on
    // `build:storybook`, so nothing is bundled here and the port binds in
    // milliseconds — the dev-server dependency optimizer is what repeatedly
    // lost the race for a port on a contended CI pod.
    command: "bun run preview:storybook",
    url: "http://127.0.0.1:5191/index.json",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://127.0.0.1:5191",
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
