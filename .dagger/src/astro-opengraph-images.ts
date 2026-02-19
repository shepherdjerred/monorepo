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
    // Root workspace files for bun install (strip workspaces to avoid resolving missing members)
    .withFile("/workspace/package.json", source.file("package.json"))
    .withFile("/workspace/bun.lock", source.file("bun.lock"))
    .withExec([
      "bun",
      "-e",
      `const pkg = JSON.parse(await Bun.file('/workspace/package.json').text()); pkg.workspaces = ['packages/astro-opengraph-images', 'packages/eslint-config']; await Bun.write('/workspace/package.json', JSON.stringify(pkg));`,
    ])
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
    .withWorkdir("/workspace")
    .withExec(["bun", "install"])
    .withWorkdir("/workspace/packages/eslint-config")
    .withExec(["bun", "run", "build"])
    .withWorkdir("/workspace/packages/astro-opengraph-images");

  // Run lint, build, test sequentially
  await container.withExec(["bun", "run", "lint"]).sync();
  await container.withExec(["bun", "run", "build"]).sync();
  await container.withExec(["bun", "run", "test"]).sync();

  return "✓ astro-opengraph-images CI passed (lint, build, test)";
}
