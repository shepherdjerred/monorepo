import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const isCI = process.env.CI !== undefined;
const wikiResolver = fileURLToPath(
  new URL("../../../scripts/lib/e2e/e2e-port.ts", import.meta.url),
);
const repoCheckout = fileURLToPath(new URL("../../..", import.meta.url));
const wikiPortResult = spawnSync(
  "bun",
  ["run", wikiResolver, "--", repoCheckout, "WIKI_E2E_PORT"],
  { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
);
if (wikiPortResult.status !== 0) {
  throw new Error(wikiPortResult.stderr || "WIKI_E2E_PORT probe failed");
}
const [wikiPortPart = "", wikiReusePart = "0"] =
  wikiPortResult.stdout.split(":");
const PORT = Number(wikiPortPart);
process.env._PLAYWRIGHT_RESOLVED_WIKI_E2E_PORT = PORT.toString();
const baseURL = `http://127.0.0.1:${PORT.toString()}`;
// Astro 7 detects agent environments and daemonizes preview automatically.
// Disable that behavior via webServer.env so Playwright owns the server
// process, observes startup failures, and tears it down with the test run.
// `--ignore-lock` avoids touching Astro's shared preview lockfile.
const previewCommand = `bun run preview -- --ignore-lock --host 127.0.0.1 --port ${PORT.toString()}`;

export default defineConfig({
  fullyParallel: true,
  outputDir: "test-results",
  reporter: isCI
    ? [
        ["github"],
        ["html", { open: "never" }],
        [
          "junit",
          {
            outputFile:
              "../../../.ci-reports/junit/shepherdjerred__docs-wiki/playwright.xml",
          },
        ],
      ]
    : "list",
  retries: isCI ? 2 : 0,
  testDir: "./tests",
  use: {
    baseURL,
    // CI only needs a trace for the retry of a failed test; passing runs write none.
    trace: isCI ? "on-first-retry" : "retain-on-failure",
  },
  webServer: {
    command: previewCommand,
    env: {
      ASTRO_DEV_BACKGROUND: "0",
      ASTRO_PREVIEW_BACKGROUND: "0",
    },
    reuseExistingServer: wikiReusePart === "1",
    url: baseURL,
    timeout: 120_000,
  },
});
