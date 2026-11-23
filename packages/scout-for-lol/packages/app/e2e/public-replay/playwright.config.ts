import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const origin = "http://127.0.0.1:5193";
const dist = "../../../../.cache/scout-public-replay-e2e-dist";

// Run from the app workspace with:
// bun --no-install --bun playwright test --config e2e/public-replay/playwright.config.ts
export default defineConfig({
  testDir: ".",
  testMatch: "public-replay.pw.ts",
  outputDir: "../../test-results/public-replay",
  webServer: {
    command: `bun run build --outDir ${dist} && bun run preview --outDir ${dist} --host 127.0.0.1 --port 5193 --strictPort`,
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    url: `${origin}/app/`,
    timeout: 120_000,
  },
  use: { baseURL: origin, serviceWorkers: "block" },
});
