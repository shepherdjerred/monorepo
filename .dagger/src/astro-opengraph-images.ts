import type { Directory } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import versions from "./lib-versions.ts";

/**
 * Check astro-opengraph-images: lint, build, test
 */
export async function checkAstroOpengraphImages(
  source: Directory,
): Promise<string> {
  const container = dag
    .container()
    .from(`oven/bun:${versions["oven/bun"]}`)
    .withWorkdir("/workspace")
    .withEnvVariable("CI", "true")
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    // Root workspace files for bun install
    .withFile("/workspace/package.json", source.file("package.json"))
    .withFile("/workspace/bun.lock", source.file("bun.lock"))
    // Package source
    .withDirectory(
      "/workspace/packages/astro-opengraph-images",
      source.directory("packages/astro-opengraph-images"),
      {
        exclude: ["node_modules", "examples", "**/.astro", "**/.dagger"],
      },
    )
    // Eslint config (needed for lint — ../eslint-config/local.ts)
    .withDirectory(
      "/workspace/packages/eslint-config",
      source.directory("packages/eslint-config"),
    )
    .withWorkdir("/workspace/packages/astro-opengraph-images")
    .withExec(["bun", "install"]);

  // Run lint, build, test sequentially
  await container.withExec(["bun", "run", "lint"]).sync();
  await container.withExec(["bun", "run", "build"]).sync();
  await container.withExec(["bun", "run", "test"]).sync();

  return "✓ astro-opengraph-images CI passed (lint, build, test)";
}
