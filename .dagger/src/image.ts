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

/** Push a built image to a registry under one or more tags. Returns the digest of the first tag published. */
export async function pushImageHelper(
  pkgDir: Directory,
  pkg: string,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Promise<string> {
  if (tags.length === 0) {
    throw new Error("pushImageHelper requires at least one tag");
  }
  const image = buildImageHelper(
    pkgDir,
    pkg,
    depNames,
    depDirs,
    version,
    gitSha,
  ).withRegistryAuth("ghcr.io", registryUsername, registryPassword);

  const digest = await image.publish(tags[0]);
  for (const tag of tags.slice(1)) {
    await image.publish(tag);
  }
  return digest;
}
