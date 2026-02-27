import type { Directory, Container, Secret } from "@dagger.io/dagger";
import {
  getBaseBunDebianContainer,
  installMonorepoWorkspaceDeps,
} from "./lib-monorepo-workspace.ts";
import type { WorkspaceEntry } from "./lib-monorepo-workspace.ts";
import { getBuiltEslintConfig } from "./lib-eslint-config.ts";

/**
 * Workspace entries for obsidian-sync-client CI/build.
 * Minimal — obsidian-sync-client only needs itself and eslint-config.
 */
const OBSIDIAN_SYNC_CLIENT_WORKSPACES: WorkspaceEntry[] = [
  "packages/obsidian-sync-client",
  "packages/eslint-config",
  // Explicit (non-glob) workspace in root package.json — must exist for bun install
  { path: "packages/clauderon/docs", fullDirPhase1: true, depsOnly: true },
];

/**
 * Install obsidian-sync-client workspace dependencies.
 */
function installObsidianSyncClientWorkspaceDeps(
  workspaceSource: Directory,
  useMounts: boolean,
): Container {
  return installMonorepoWorkspaceDeps({
    baseContainer: getBaseBunDebianContainer(),
    source: workspaceSource,
    useMounts,
    workspaces: OBSIDIAN_SYNC_CLIENT_WORKSPACES,
    rootConfigFiles: ["tsconfig.base.json"],
  });
}

/**
 * Get a prepared container with all dependencies installed (using mounts for CI).
 */
function getObsidianSyncClientPrepared(workspaceSource: Directory): Container {
  const builtEslintConfig = getBuiltEslintConfig(workspaceSource);
  return installObsidianSyncClientWorkspaceDeps(workspaceSource, true)
    .withDirectory(
      "/workspace/packages/eslint-config/dist",
      builtEslintConfig.directory("dist"),
    )
    .withWorkdir("/workspace/packages/obsidian-sync-client");
}

/**
 * Run type checking, linting, and tests for obsidian-sync-client in PARALLEL.
 * Uses TEST_MODE=unit to skip real API calls.
 */
export async function checkObsidianSyncClient(
  source: Directory,
): Promise<string> {
  const prepared = getObsidianSyncClientPrepared(source)
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
  return installObsidianSyncClientWorkspaceDeps(source, false)
    .withWorkdir("/workspace/packages/obsidian-sync-client")
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
