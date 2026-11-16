import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from "@playwright/test";

const isCI = process.env.CI === "true";
const includeBrandedBrowsers =
  process.env.PLAYWRIGHT_BRANDED_BROWSERS === "true";

const siteProbe = spawnSync(
  "bun",
  [
    "run",
    fileURLToPath(
      new URL("../../scripts/lib/e2e/e2e-port.ts", import.meta.url),
    ),
    "--",
    fileURLToPath(new URL("../..", import.meta.url)),
    "SJER_RED_E2E_PORT",
  ],
  { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
);
if (siteProbe.status !== 0) {
  throw new Error(siteProbe.stderr || "SJER_RED_E2E_PORT probe failed");
}
const [sitePortText = "", siteReuseFlag = "0"] = siteProbe.stdout.split(":");
const PORT = Number(sitePortText);
process.env._PLAYWRIGHT_RESOLVED_SJER_RED_E2E_PORT = String(PORT);
const baseURL = `http://127.0.0.1:${PORT.toString()}`;
const previewCommand = `bun run preview -- --ignore-lock --host 127.0.0.1 --port ${PORT.toString()}`;

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
    baseURL,
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
    command: previewCommand,
    env: {
      ASTRO_DEV_BACKGROUND: "0",
      ASTRO_PREVIEW_BACKGROUND: "0",
    },
    url: baseURL,
    timeout: 120 * 1000,
    reuseExistingServer: siteReuseFlag === "1",
  },
});
