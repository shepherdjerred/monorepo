import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { replayPath } from "./recorded-replay-data.ts";

const origin = "http://127.0.0.1:5195";
const config = "e2e/public-replay/recorded-vite.config.ts";
const build = `bun run build --config ${config}`;
const preview = "bun e2e/public-replay/recorded-preview.ts 5195";

export default defineConfig({
  testDir: ".",
  testMatch: "recorded-replay.pw.ts",
  outputDir: "../../test-results/recorded-replay",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  webServer: {
    command:
      Bun.env["SCOUT_REPLAY_E2E_REUSE_DIST"] === "1"
        ? preview
        : `${build} && ${preview}`,
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    url: `${origin}${replayPath}`,
    timeout: 180_000,
  },
  use: {
    baseURL: origin,
    serviceWorkers: "block",
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
});
