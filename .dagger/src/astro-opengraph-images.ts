import type { Directory, Container } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";

/**
 * Check astro-opengraph-images: lint, build, test
 */
export async function checkAstroOpengraphImages(
  source: Directory,
): Promise<string> {
  const pkgSource = source.directory("packages/astro-opengraph-images");

  const container = dag
    .container()
    .from("oven/bun:latest")
    .withWorkdir("/workspace")
    .withEnvVariable("CI", "true")
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    .withDirectory("/workspace", pkgSource, {
      exclude: ["node_modules", "examples", "**/.astro", "**/.dagger"],
    })
    .withExec(["bun", "install", "--frozen-lockfile"]);

  // Run lint, build, test sequentially
  await container.withExec(["bun", "run", "lint"]).sync();
  await container.withExec(["bun", "run", "build"]).sync();
  await container.withExec(["bun", "run", "test"]).sync();

  return "✓ astro-opengraph-images CI passed (lint, build, test)";
}
