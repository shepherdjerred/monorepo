import { defineConfig } from "@playwright/test";

const isCI = process.env["CI"] === "true";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  // Playwright derives its default worker count from os.cpus(), which reports
  // the *node's* CPUs, not the container's cgroup limit — on the CI node that
  // spawned 16 Chromium workers against a single Vite dev server in a pod
  // limited to 4 CPUs, while turbo ran a second package task alongside it.
  // The starved workers exceeded the 30s test timeout on plain navigation
  // (page.reload / goto), so tests failed on contention rather than content.
  // Cap to the pod's usable share; the suite is independent per test, so this
  // costs wall time and nothing else.
  workers: isCI ? 2 : "50%",
  forbidOnly: isCI,
  reporter: isCI
    ? [
        ["list"],
        [
          "junit",
          {
            outputFile:
              "../../../../.ci-reports/junit/scout-for-lol__activity/playwright.xml",
          },
        ],
      ]
    : "list",
  snapshotDir: "./e2e",
  snapshotPathTemplate: "{snapshotDir}/{testFilePath}-snapshots/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:5181/customs/",
    trace: "retain-on-failure",
  },
  webServer: {
    // Serve the built `dist` rather than a dev server. `test:e2e` already
    // dependsOn `build`, so the bundle exists; preview then just serves files
    // and is ready in milliseconds.
    //
    // A dev server is what kept failing here. The browser-E2E lane runs
    // `turbo run test:e2e --concurrency=2`, which pairs this package with the
    // design-system workbench — 48 tests over six browser projects at three
    // workers — inside one CPU-limited pod. Vite's dependency optimizer has to
    // scan the whole graph (including design-system's source) before it binds,
    // so it lost that race and the port never opened: build 13670 timed out at
    // 60s, and after raising the budget to 120s and adding --force, build 13917
    // timed out again at 120s having printed nothing at all. Raising it a third
    // time treats a starvation symptom; not optimizing at all removes it.
    //
    // Nothing here needs a dev server: the flows stub every /api and /trpc call
    // with page.route, so `server.proxy` is never exercised, and the shared
    // Scout assets are served by scoutAssetsPlugin's configurePreviewServer
    // hook — the same middleware it installs for dev — so /assets/scout/**
    // resolves identically and the screenshot baselines still match.
    //
    // --strictPort makes a port collision fail loudly instead of silently
    // serving somewhere else.
    command: "bun run preview -- --host 127.0.0.1 --port 5181 --strictPort",
    url: "http://127.0.0.1:5181/customs/",
    // Generous headroom for a server that binds in milliseconds; matches
    // sjer.red, alert-dashboard, evals, and design-system.
    timeout: 120_000,
    reuseExistingServer: !isCI,
  },
});
