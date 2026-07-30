import { defineConfig } from "@playwright/test";

const PORT = 4358;
const baseURL = `http://127.0.0.1:${PORT.toString()}`;
const isCI = process.env.CI !== undefined;

export default defineConfig({
  fullyParallel: true,
  outputDir: "test-results",
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  retries: isCI ? 2 : 0,
  testDir: "./tests",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bun run preview --host 127.0.0.1 --port ${PORT.toString()}`,
    reuseExistingServer: !isCI,
    url: baseURL,
  },
});
