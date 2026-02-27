import type { Directory, Container, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import versions from "./lib-versions.ts";

const BUN_VERSION = versions.bun;

/**
 * Get a base container for the obsidian-sync-client package.
 * Standalone package (not a workspace member) — copies its own source and installs deps.
 */
function getBaseContainer(
  source: Directory,
  useMounts: boolean,
): Container {
  const pkgDir = source.directory("packages/obsidian-sync-client");

  let container = dag
    .container()
    .from(`oven/bun:${BUN_VERSION}-debian`)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    .withWorkdir("/workspace");

  container = useMounts ? container.withMountedDirectory("/workspace", pkgDir) : container.withDirectory("/workspace", pkgDir);

  return container.withExec(["bun", "install", "--frozen-lockfile"]);
}

/**
 * Run type checking, linting, and tests for obsidian-sync-client in PARALLEL.
 * Uses TEST_MODE=unit to skip real API calls.
 */
export async function checkObsidianSyncClient(
  source: Directory,
): Promise<string> {
  const prepared = getBaseContainer(source, true)
    .withEnvVariable("TEST_MODE", "unit");

  await Promise.all([
    prepared.withExec(["bun", "run", "typecheck"]).sync(),
    prepared.withExec(["bun", "run", "lint"]).sync(),
    prepared.withExec(["bun", "run", "test"]).sync(),
  ]);

  return "✓ Obsidian Sync Client CI passed (typecheck, lint, test)";
}

/**
 * Build the obsidian-sync-client Docker image for production.
 */
export function buildObsidianSyncClientImage(
  source: Directory,
  version: string,
  _gitSha: string,
): Container {
  return getBaseContainer(source, false)
    .withEnvVariable("NODE_ENV", "production")
    .withEntrypoint(["bun", "run", "src/index.ts"])
    .withLabel("org.opencontainers.image.title", "obsidian-sync-client")
    .withLabel(
      "org.opencontainers.image.description",
      "Headless Obsidian Sync client for keeping a local vault directory in sync",
    )
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version);
}

/**
 * Run obsidian-sync-client CI validation.
 * No smoke test for the sync client — it requires real Obsidian credentials.
 */
export async function runObsidianSyncClientValidation(
  source: Directory,
): Promise<string> {
  return checkObsidianSyncClient(source);
}

type PublishOptions = {
  image: Container;
  version: string;
  gitSha: string;
  registryAuth?: {
    username: string;
    password: Secret;
  } | undefined;
};

export async function publishObsidianSyncClientImage(
  options: PublishOptions,
): Promise<{ refs: string[]; versionedRef: string }> {
  let image = options.image;

  if (options.registryAuth) {
    image = image.withRegistryAuth(
      "ghcr.io",
      options.registryAuth.username,
      options.registryAuth.password,
    );
  }

  const versionRef = await image.publish(
    `ghcr.io/shepherdjerred/obsidian-sync-client:${options.version}`,
  );
  const shaRef = await image.publish(
    `ghcr.io/shepherdjerred/obsidian-sync-client:${options.gitSha}`,
  );
  const latestRef = await image.publish(
    "ghcr.io/shepherdjerred/obsidian-sync-client:latest",
  );

  return { refs: [versionRef, shaRef, latestRef], versionedRef: versionRef };
}
