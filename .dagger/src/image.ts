/**
 * OCI image build and push helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory, Secret } from "@dagger.io/dagger";

import { BUN_IMAGE, BUN_CACHE } from "./constants";

/**
 * Build a Bun service OCI image. Constructs a minimal workspace with
 * only the target package and its workspace deps — no file modification.
 */
export function buildImageHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Container {
  const excludes = ["node_modules", "dist", ".eslintcache"];

  // Build a minimal workspace: target + needed packages
  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir("/workspace")
    .withDirectory(`/workspace/packages/${pkg}`, pkgDir, {
      exclude: excludes,
    });

  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  // Install deps then set up the final image
  return container
    .withWorkdir(`/workspace/packages/${pkg}`)
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withExposedPort(8000)
    .withEntrypoint(["bun", "run", "src/index.ts"]);
}

/** Push a built image to a registry. Returns the published image digest. */
export function pushImageHelper(
  pkgDir: Directory,
  pkg: string,
  tag: string,
  registryUsername: string,
  registryPassword: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Promise<string> {
  const image = buildImageHelper(
    pkgDir,
    pkg,
    depNames,
    depDirs,
    version,
    gitSha,
  );
  return image
    .withRegistryAuth("ghcr.io", registryUsername, registryPassword)
    .publish(tag);
}
