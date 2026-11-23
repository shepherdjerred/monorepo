import { defineConfig } from "@playwright/test";
import recordedConfig from "./recorded-playwright.config.ts";

const graphics = Bun.env["SCOUT_REPLAY_E2E_PERF_GRAPHICS"] ?? "edge";
if (graphics !== "edge" && graphics !== "swiftshader")
  throw new Error(
    "SCOUT_REPLAY_E2E_PERF_GRAPHICS must be edge or swiftshader.",
  );

export default defineConfig({
  ...recordedConfig,
  testMatch: "recorded-performance.pw.ts",
  outputDir: "../../test-results/recorded-performance",
  workers: 1,
  use: {
    ...recordedConfig.use,
    // The 1600 CSS pixel page has 64px of padding and two 1px player borders.
    viewport: { width: 1600, height: 1100 },
    deviceScaleFactor: 1920 / 1534,
    channel: graphics === "edge" ? "msedge" : undefined,
    headless: true,
    launchOptions: {
      args:
        graphics === "edge"
          ? ["--enable-gpu"]
          : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
});
