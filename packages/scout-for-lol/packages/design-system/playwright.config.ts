import { defineConfig, devices } from "@playwright/test";
import { env } from "node:process";
import { storybookCiReporter } from "#src/storybook/e2e.ts";

const isCI = env["CI"] === "true";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  forbidOnly: isCI,
  // Omitted rather than set to undefined so Playwright keeps its own default
  // locally; exactOptionalPropertyTypes rejects the explicit undefined.
  ...(isCI ? { workers: 3 } : {}),
  reporter: isCI ? storybookCiReporter("scout-for-lol__design-system") : "list",
  outputDir: "./test-results",
  webServer: {
    // A static server over the already-built catalog. `test:e2e` depends on
    // `build`, so there is nothing left to bundle here: this binds in
    // milliseconds instead of racing Vite's dependency optimizer on a
    // contended pod, which is what repeatedly stalled the old dev-server
    // webServer past its timeout.
    command: "bun run preview",
    url: "http://127.0.0.1:6006/index.json",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://127.0.0.1:6006",
    // reducedMotion is a browser-context option, not a top-level use option.
    // Spelled the other way it typechecks as an unknown property and silently
    // does nothing, which is how the previous config carried it.
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
