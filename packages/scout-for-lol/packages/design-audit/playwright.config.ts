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

// `dev:design-audit` (scripts/dev-web.ts) hard-fails when required Scout
// secrets are missing or still look like unresolved 1Password references
// (`op://...`). CI injects fully-resolved secrets directly into the
// container env via `buildkite-ci-secrets`, so the command can run as-is
// there; a local developer's shell instead holds `op://` template values
// from dev-web.env.tpl and needs `op run` to resolve them first, exactly
// like the `dev:web` local-dev command does.
const devDesignAuditCommand =
  env["CI"] === "true"
    ? "bun --no-install run dev:design-audit"
    : "op run --env-file=dev-web.env.tpl -- bun run dev:design-audit";

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
  outputDir: "./test-results",
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
