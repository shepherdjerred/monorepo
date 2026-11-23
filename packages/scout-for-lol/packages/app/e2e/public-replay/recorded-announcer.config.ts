import { defineConfig } from "@playwright/test";
import recordedConfig from "./recorded-playwright.config.ts";

export default defineConfig({
  ...recordedConfig,
  testMatch: "recorded-announcer.pw.ts",
  outputDir: "../../test-results/recorded-announcer",
});
