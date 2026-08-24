import { defineConfig, devices, type Project } from "@playwright/test";
import { env } from "node:process";
import {
  auditProjectGrep,
  auditProjects,
  auditViewport,
} from "./src/matrix.ts";

const mode = env["SCOUT_DESIGN_AUDIT_MODE"];
if (mode !== undefined && mode !== "pr" && mode !== "nightly") {
  throw new Error(
    `SCOUT_DESIGN_AUDIT_MODE must be pr or nightly, received ${mode}`,
  );
}
const ciShard = env["SCOUT_DESIGN_AUDIT_SHARD"];
if (ciShard !== undefined && !/^(?:[1-9]|1[0-6])$/.test(ciShard)) {
  throw new Error(
    `SCOUT_DESIGN_AUDIT_SHARD must be an integer from 1 through 16, received ${ciShard}`,
  );
}
const ciShardSuffix = ciShard === undefined ? "" : `-shard-${ciShard}`;
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
for (const project of auditProjects) {
  const viewport = auditViewport(project);
  // WebKit uses the iPhone/Desktop Safari device profiles and Chromium uses
  // the Galaxy/Desktop Chrome ones, so each viewport gets a realistic UA and
  // touch profile rather than a resized desktop.
  const device =
    project.browser === "webkit"
      ? viewport.isMobile
        ? devices["iPhone 13"]
        : devices["Desktop Safari"]
      : viewport.isMobile
        ? devices["Galaxy S9+"]
        : devices["Desktop Chrome"];
  projects.push({
    name: project.name,
    grep: auditProjectGrep(project),
    use: {
      ...device,
      browserName: project.browser,
      isMobile: viewport.isMobile,
      viewport: { width: viewport.width, height: viewport.height },
    },
  });
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
  // Parallel browser contexts plus the backend, SPA, and two Astro servers
  // exceeded the nightly pod's memory boundary even at two workers. One worker
  // keeps the complete 616-case matrix inside the reviewed 16 GiB limit.
  ...(env["CI"] === "true" ? { workers: 1 } : {}),
  reporter:
    env["CI"] === "true"
      ? [
          ["github"],
          [
            "junit",
            {
              outputFile: `../../../../.ci-reports/junit/scout-for-lol__design-audit/playwright${ciShardSuffix}.xml`,
            },
          ],
        ]
      : "list",
  outputDir:
    env["CI"] === "true"
      ? `../../../../.ci-reports/playwright/scout-for-lol__design-audit${ciShardSuffix}`
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
          // Playwright defaults to 60s. All three of these boot inside the
          // browser-E2E pod alongside sjer.red and design-system at
          // --concurrency=2, where a starved server needs well past a minute.
          // 120s matches sjer.red, alert-dashboard, and evals.
          {
            // Astro 7 backgrounds dev servers when it detects an AI agent.
            // Playwright owns this foreground process; ignoring Astro's own
            // lock avoids leaving a stale PID after Playwright stops it.
            command:
              "ASTRO_DEV_BACKGROUND=0 bun --no-install run dev -- --host 127.0.0.1 --port 4321 --ignore-lock",
            cwd: "../../../../packages/scout-for-lol/packages/frontend",
            url: "http://127.0.0.1:4321/",
            reuseExistingServer: env["CI"] !== "true",
            timeout: 120_000,
          },
          {
            command:
              "ASTRO_DEV_BACKGROUND=0 bun --no-install run dev -- --host 127.0.0.1 --port 4322 --ignore-lock",
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
