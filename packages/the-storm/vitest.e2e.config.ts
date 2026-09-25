import path from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import { z } from "zod";

// The repository-wide Vitest config is untyped TypeScript; loading it by a
// computed path keeps it out of this package's strict type program.
const rootConfigPath = path.join(
  import.meta.dirname,
  "..",
  "..",
  "vitest.config.ts",
);
const RootConfigModuleSchema = z.object({
  default: z.record(z.string(), z.unknown()),
});
const rootConfig = RootConfigModuleSchema.parse(
  await import(rootConfigPath),
).default;

// Real-server end-to-end suite: one disposable Paper server per run, shared
// by every file. Run with `bun run test:e2e` after building TheStorm.jar.
export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      include: ["tests/e2e/**/*.e2e.test.ts"],
      globalSetup: ["tests/e2e/global-setup.ts"],
      // One shared server and world: files must not race each other.
      fileParallelism: false,
      testTimeout: 60_000,
      // Covers a cold boot that downloads Paper and patches the Mojang jar.
      hookTimeout: 200_000,
    },
  }),
);
