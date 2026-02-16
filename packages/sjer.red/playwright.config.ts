import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  fullyParallel: true,
  forbidOnly: process.env.CI === "true",
  retries: 1,
  workers: "200%",
  reporter: process.env.CI === "true" ? "github" : "html",
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
  },
  expect: {
    toHaveScreenshot: {
      // Allow for small rendering differences between environments
      maxDiffPixelRatio: 0.02,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "Mobile Safari",
      use: { ...devices["iPhone 12"] },
    },
    {
      name: "Microsoft Edge",
      use: { ...devices["Desktop Edge"], channel: "msedge" },
    },
    {
      name: "Google Chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },

    {
      name: "chromium (Dark)",
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
    },
    {
      name: "firefox (Dark)",
      use: { ...devices["Desktop Firefox"], colorScheme: "dark" },
    },
    {
      name: "webkit (Dark)",
      use: { ...devices["Desktop Safari"], colorScheme: "dark" },
    },
    {
      name: "Mobile Chrome (Dark)",
      use: { ...devices["Pixel 5"], colorScheme: "dark" },
    },
    {
      name: "Mobile Safari (Dark)",
      use: { ...devices["iPhone 12"], colorScheme: "dark" },
    },
    {
      name: "Microsoft Edge (Dark)",
      use: { ...devices["Desktop Edge"], channel: "msedge", colorScheme: "dark" },
    },
    {
      name: "Google Chrome (Dark)",
      use: { ...devices["Desktop Chrome"], channel: "chrome", colorScheme: "dark" },
    },
  ],
  webServer: {
    // Use bun for both local and CI (CI container now has Bun installed)
    // Add --host in CI to bind to all interfaces (not just localhost)
    command: process.env.CI ? "bun run preview -- --host" : "bun run preview",
    url: "http://localhost:4321",
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  },
});
