import { defineConfig, devices, type Project } from "@playwright/test";
import { env } from "node:process";
import { viewports } from "./src/constants.ts";

const mode = env["SCOUT_DESIGN_AUDIT_MODE"];
if (mode !== undefined && mode !== "pr" && mode !== "nightly") {
  throw new Error(
    `SCOUT_DESIGN_AUDIT_MODE must be pr or nightly, received ${mode}`,
  );
}
const isNightly = mode === "nightly";
const startLocalServers =
  env["SCOUT_DESIGN_AUDIT_START_LOCAL_SERVERS"] === "true";
if (
  isNightly &&
  env["CI"] === "true" &&
  !startLocalServers &&
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
// Chrome and Safari are the browsers that matter for this product. Firefox was
// dropped deliberately: it added a third of the matrix for a rendering engine
// nobody targets. The suite runs nightly rather than per-commit, so both
// browsers run every time and there is no mode branch here.
const browsers = ["chromium", "webkit"] as const;

// `dev:design-audit` (scripts/dev-web.ts) boots the real Scout backend, which
// normally requires real DISCORD_TOKEN/DISCORD_CLIENT_SECRET/
// JWT_SIGNING_SECRET/RIOT_API_KEY (and a live Discord login). The design
// audit only exercises read-only UI routes via the dev-login session, so
// SCOUT_DESIGN_AUDIT_LOCAL_BOOT=true tells dev-web.ts to skip that
// requirement entirely (see scripts/dev-web.ts) rather than needing either
// real CI secrets or a local 1Password session just to smoke-test the UI.
const devDesignAuditCommand =
  "SCOUT_DESIGN_AUDIT_LOCAL_BOOT=true bun --no-install run dev:design-audit -- --no-discord-gateway";

const projects: Project[] = [];
for (const browser of browsers) {
  for (const viewport of viewports) {
    // Safari is exercised through the iPhone/Desktop Safari device profiles and
    // Chrome through the Galaxy/Desktop Chrome ones, so each viewport gets a
    // realistic UA and touch profile rather than a resized desktop.
    const device =
      browser === "webkit"
        ? viewport.isMobile
          ? devices["iPhone 13"]
          : devices["Desktop Safari"]
        : viewport.isMobile
          ? devices["Galaxy S9+"]
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
  expect: {
    timeout: 10_000,
    // Goldens are generated in the pinned ci-playwright image and compared in
    // that same image, so this absorbs antialiasing noise rather than papering
    // over a cross-platform mismatch. Matches packages/sjer.red.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
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
    permissions: ["clipboard-read", "clipboard-write"],
    screenshot: "only-on-failure",
    trace: "off",
  },
  ...(startLocalServers
    ? {
        webServer: [
          // Playwright defaults to 60s. All three of these boot inside the
          // browser-E2E pod alongside sjer.red and design-system at
          // --concurrency=2, where a starved server needs well past a minute.
          // 120s matches sjer.red, alert-dashboard, and evals.
          {
            command: "bun --no-install run dev -- --host 127.0.0.1 --port 4321",
            cwd: "../../../../packages/scout-for-lol/packages/frontend",
            url: "http://127.0.0.1:4321/",
            reuseExistingServer: env["CI"] !== "true",
            timeout: 120_000,
          },
          {
            command: "bun --no-install run dev -- --host 127.0.0.1 --port 4322",
            cwd: "../../../../packages/scout-for-lol/packages/docs-site",
            url: "http://127.0.0.1:4322/docs/",
            reuseExistingServer: env["CI"] !== "true",
            timeout: 120_000,
          },
          {
            command: devDesignAuditCommand,
            cwd: "../../../../packages/scout-for-lol",
            // Probe the BACKEND, not the SPA. `/app/login` is static vite
            // output served the moment the dev server binds, so readiness used
            // to fire while the backend was still running prisma migrate,
            // prisma generate, and the design-audit seed. Every /api and /trpc
            // call then hit the proxy with nothing behind it —
            // `ECONNREFUSED`, surfaced as 502 — which is what failed all 672
            // app-route tests on build 10794. `/api/version` is proxied to the
            // backend and reports pure build identity, so it answers only once
            // the backend is actually listening (unlike `/healthz`, which also
            // probes the Riot API and would make readiness depend on a third
            // party).
            url: "http://localhost:5180/api/version",
            reuseExistingServer: env["CI"] !== "true",
            // This one gets more than the other two on purpose: before it
            // listens it runs `prisma migrate deploy`, `prisma generate`, and
            // the design-audit seed (scripts/dev-web.ts), then starts the
            // backend. That is minutes of real work, not just a dev server.
            timeout: 300_000,
          },
        ],
      }
    : {}),
  projects,
});
