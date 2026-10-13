import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4327/build-your-own-react/",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command:
      "ASTRO_PREVIEW_BACKGROUND=0 bun run preview --host 127.0.0.1 --port 4327",
    url: "http://127.0.0.1:4327/build-your-own-react/",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
