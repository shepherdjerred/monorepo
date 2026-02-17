import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for screenshot generation
 *
 * Run with: bun run screenshots
 * Or: playwright test tests/screenshots
 */
export default defineConfig({
  // Test files are in current directory (config is at tests/screenshots/)
  testDir: ".",

  // Output directory for screenshots
  outputDir: "../../screenshots/web",

  // Timeout settings
  timeout: 30000,
  expect: {
    timeout: 5000,
  },

  // Run tests serially for consistent screenshots
  fullyParallel: false,
  workers: 1,

  // Retry failed tests once
  retries: 1,

  // Reporter configuration
  reporter: [["list"], ["html", { outputFolder: "playwright-report" }]],

  // Shared settings for all projects
  use: {
    // Base URL - assumes dev server is running
    baseURL: "http://localhost:5173",

    // Screenshot settings - high quality
    screenshot: {
      mode: "only-on-failure",
      fullPage: false,
    },

    // Viewport size for screenshots - 1080p for high quality
    viewport: { width: 1920, height: 1080 },

    // Ignore HTTPS errors for local development
    ignoreHTTPSErrors: true,
  },

  // Projects for different scenarios
  projects: [
    {
      name: "chromium-light",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "light",
      },
    },

    {
      name: "chromium-dark",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "dark",
      },
    },
  ],

  // Note: Start dev server manually before running screenshots
  // Run: bun run dev (in a separate terminal)
});
