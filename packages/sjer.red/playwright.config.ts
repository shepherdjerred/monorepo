import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from "@playwright/test";

const isCI = process.env.CI === "true";
const includeBrandedBrowsers =
  process.env.PLAYWRIGHT_BRANDED_BROWSERS === "true";

const brandedBrowserProjects = [
  {
    name: "Microsoft Edge",
    use: { ...devices["Desktop Edge"], channel: "msedge" },
  },
  {
    name: "Google Chrome",
    use: { ...devices["Desktop Chrome"], channel: "chrome" },
  },
] satisfies NonNullable<PlaywrightTestConfig["projects"]>;

const brandedBrowserDarkProjects = [
  {
    name: "Microsoft Edge (Dark)",
    use: {
      ...devices["Desktop Edge"],
      channel: "msedge",
      colorScheme: "dark",
    },
  },
  {
    name: "Google Chrome (Dark)",
    use: {
      ...devices["Desktop Chrome"],
      channel: "chrome",
      colorScheme: "dark",
    },
  },
] satisfies NonNullable<PlaywrightTestConfig["projects"]>;

export default defineConfig({
  testDir: "./test",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 1,
  workers: 2,
  reporter: isCI ? "github" : "list",
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
    ...(includeBrandedBrowsers ? brandedBrowserProjects : []),

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
    ...(includeBrandedBrowsers ? brandedBrowserDarkProjects : []),
  ],
  webServer: {
    // Use bun for both local and CI (CI container now has Bun installed)
    // Add --host in CI to bind to all interfaces (not just localhost)
    command: isCI ? "bun run preview -- --host" : "bun run preview",
    url: "http://localhost:4321",
    timeout: 120 * 1000,
    reuseExistingServer: !isCI,
  },
});
