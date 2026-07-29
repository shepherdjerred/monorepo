import { defineConfig } from "@playwright/test";

const PORT = 4_358;
const baseURL = `http://127.0.0.1:${PORT.toString()}`;

export default defineConfig({
  fullyParallel: true,
  outputDir: "test-results",
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  retries: process.env.CI ? 2 : 0,
  testDir: "./tests",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bun run preview --host 127.0.0.1 --port ${PORT.toString()}`,
    reuseExistingServer: !process.env.CI,
    url: baseURL,
  },
});
