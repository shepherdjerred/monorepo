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
  reporter: isCI
    ? [
        ["list"],
        [
          "junit",
          {
            outputFile: "../../.ci-reports/junit/sjer.red/playwright.xml",
          },
        ],
      ]
    : "list",
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
    // Astro 7 detects agent environments and daemonizes preview automatically.
    // Disable that behavior so Playwright owns the server process and can
    // observe startup failures and tear it down with the test run.
    command: isCI
      ? "ASTRO_PREVIEW_BACKGROUND=0 bun run preview --host 127.0.0.1 --port 4321"
      : "bun run preview",
    url: "http://localhost:4321",
    timeout: 120 * 1000,
    reuseExistingServer: !isCI,
  },
});
