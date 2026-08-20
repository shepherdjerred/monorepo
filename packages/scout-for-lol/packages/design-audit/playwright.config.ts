import { defineConfig, devices, type Project } from "@playwright/test";
import { env } from "node:process";
import { viewports } from "./src/constants.ts";

const isNightly = env["SCOUT_DESIGN_AUDIT_MODE"] === "nightly";
const startLocalServers =
  env["SCOUT_DESIGN_AUDIT_START_LOCAL_SERVERS"] === "true";
if (
  isNightly &&
  env["CI"] === "true" &&
  (env["SCOUT_DESIGN_AUDIT_BASE_URL"] === undefined ||
    env["SCOUT_DESIGN_AUDIT_BASE_URL"].length === 0) &&
  [
    env["SCOUT_DESIGN_AUDIT_PUBLIC_URL"],
    env["SCOUT_DESIGN_AUDIT_DOCS_URL"],
    env["SCOUT_DESIGN_AUDIT_APP_URL"],
  ].some((value) => value === undefined || value.length === 0)
) {
  throw new Error(
    "Nightly Scout design checks require SCOUT_DESIGN_AUDIT_BASE_URL or all three of SCOUT_DESIGN_AUDIT_PUBLIC_URL, SCOUT_DESIGN_AUDIT_DOCS_URL, and SCOUT_DESIGN_AUDIT_APP_URL",
  );
}
const browsers = isNightly
  ? (["chromium", "firefox", "webkit"] as const)
  : (["chromium"] as const);

// `dev:design-audit` (scripts/dev-web.ts) boots the real Scout backend, which
// normally requires real DISCORD_TOKEN/DISCORD_CLIENT_SECRET/
// JWT_SIGNING_SECRET/RIOT_API_KEY (and a live Discord login). The design
// audit only exercises read-only UI routes via the dev-login session, so
// SCOUT_DESIGN_AUDIT_LOCAL_BOOT=true tells dev-web.ts to skip that
// requirement entirely (see scripts/dev-web.ts) rather than needing either
// real CI secrets or a local 1Password session just to smoke-test the UI.
const devDesignAuditCommand =
  "SCOUT_DESIGN_AUDIT_LOCAL_BOOT=true bun --no-install run dev:design-audit";

const projects: Project[] = [];
for (const browser of browsers) {
  for (const viewport of viewports) {
    const device = viewport.isMobile
      ? devices["iPhone 13"]
      : devices["Desktop Chrome"];
    projects.push({
      name: `${browser}-${viewport.name}`,
      use: {
        ...device,
        browserName: browser,
        isMobile: viewport.isMobile,
        viewport: { width: viewport.width, height: viewport.height },
      },
    });
  }
}

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  forbidOnly: env["CI"] === "true",
  fullyParallel: true,
  ...(env["CI"] === "true" ? { workers: 3 } : {}),
  reporter:
    env["CI"] === "true"
      ? [
          ["github"],
          [
            "junit",
            {
              outputFile:
                "../../../../.ci-reports/junit/scout-for-lol__design-audit/playwright.xml",
            },
          ],
        ]
      : "list",
  outputDir:
    env["CI"] === "true"
      ? "../../../../.ci-reports/playwright/scout-for-lol__design-audit"
      : "./test-results",
  snapshotDir: "./tests/__screenshots__",
  snapshotPathTemplate:
    "{snapshotDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}",
  use: {
    baseURL: env["SCOUT_DESIGN_AUDIT_BASE_URL"] ?? "http://127.0.0.1:4321",
    screenshot: "only-on-failure",
    trace: "off",
  },
  ...(startLocalServers
    ? {
        webServer: [
          {
            command: "bun --no-install run dev -- --host 127.0.0.1 --port 4321",
            cwd: "../../../../packages/scout-for-lol/packages/frontend",
            url: "http://127.0.0.1:4321/",
            reuseExistingServer: env["CI"] !== "true",
          },
          {
            command: "bun --no-install run dev -- --host 127.0.0.1 --port 4322",
            cwd: "../../../../packages/scout-for-lol/packages/docs-site",
            url: "http://127.0.0.1:4322/docs/",
            reuseExistingServer: env["CI"] !== "true",
          },
          {
            command: devDesignAuditCommand,
            cwd: "../../../../packages/scout-for-lol",
            url: "http://localhost:5180/app/login",
            reuseExistingServer: env["CI"] !== "true",
          },
        ],
      }
    : {}),
  projects,
});
