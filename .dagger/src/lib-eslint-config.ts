/**
 * Shared pre-built eslint-config directory.
 *
 * Builds eslint-config once in a dedicated container and returns the entire
 * package directory with dist/ populated. Consumers mount this directory
 * instead of building eslint-config from source in each package check.
 *
 * Dagger deduplicates this: if called multiple times with the same source,
 * it only executes once.
 */
import type { Directory } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import versions from "./lib-versions.ts";

/**
 * Build eslint-config and return the complete package directory with dist/ populated.
 * The returned Directory includes source files (local.ts, local.js, etc.) and
 * the compiled dist/ output from tsc.
 *
 * @param source The monorepo root source directory
 * @returns The built eslint-config directory ready to be mounted
 */
export function getBuiltEslintConfig(source: Directory): Directory {
  return dag
    .container()
    .from(`oven/bun:${versions.bun}`)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    .withWorkdir("/workspace/packages/eslint-config")
    .withDirectory(
      "/workspace/packages/eslint-config",
      source.directory("packages/eslint-config"),
    )
    .withFile(
      "/workspace/tsconfig.base.json",
      source.file("tsconfig.base.json"),
    )
    .withExec(["bun", "install"])
    .withExec(["bun", "run", "build"])
    .directory("/workspace/packages/eslint-config");
}
