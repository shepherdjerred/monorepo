import {
  dag,
  type Container,
  type Directory,
  type Platform,
} from "@dagger.io/dagger";
import { getMiseRuntimeContainer, type MiseToolVersions } from "./mise.ts";

/**
 * Configuration for workspace container setup
 */
export type WorkspaceConfig = {
  /** Workspace paths relative to repo root (e.g., ["packages/backend", "packages/frontend"]) */
  workspaces: string[];
  /** Root-level files to copy (e.g., ["package.json", "bun.lock"]) */
  rootFiles?: string[];
  /** Root-level directories to copy (e.g., ["patches"]) */
  rootDirectories?: string[];
  /** Config files to copy from root */
  configFiles?: {
    eslint?: string;
    prettier?: string;
    tsconfig?: string;
  };
  /** Custom eslint rules directory to copy */
  eslintRulesDir?: string;
};

/**
 * Creates a workspace-specific container with dependencies installed.
 * Uses Docker layer caching: copy dependency files -> install -> copy source.
 *
 * This is a generalized version that works with any monorepo structure.
 *
 * @param repoRoot - The repository root directory (must contain package.json, bun.lock, etc.)
 * @param workspacePath - The path to the workspace relative to repo root (e.g., "packages/backend")
 * @param config - Workspace configuration specifying files and directories to copy
 * @param platform - Optional platform specification
 * @param toolVersions - Optional specific versions for mise tools
 * @returns A configured container with workspace dependencies installed
 */
export function getWorkspaceContainer(
  repoRoot: Directory,
  workspacePath: string,
  config: WorkspaceConfig,
  platform?: Platform,
  toolVersions?: MiseToolVersions,
): Container {
  const {
    workspaces,
    rootFiles = ["package.json", "bun.lock"],
    rootDirectories = [],
    configFiles = {},
    eslintRulesDir,
  } = config;

  let container = getMiseRuntimeContainer(platform, toolVersions).withWorkdir(
    "/workspace",
  );

  // Copy root-level files
  for (const file of rootFiles) {
    container = container.withFile(file, repoRoot.file(file));
  }

  // Copy root-level directories
  for (const dir of rootDirectories) {
    container = container.withDirectory(dir, repoRoot.directory(dir));
  }

  // Copy config files if specified
  if (configFiles.eslint) {
    container = container.withFile(
      configFiles.eslint,
      repoRoot.file(configFiles.eslint),
    );
  }
  if (configFiles.prettier) {
    container = container.withFile(
      configFiles.prettier,
      repoRoot.file(configFiles.prettier),
    );
  }
  if (configFiles.tsconfig) {
    container = container.withFile(
      configFiles.tsconfig,
      repoRoot.file(configFiles.tsconfig),
    );
  }

  // Copy eslint rules directory if specified
  if (eslintRulesDir) {
    container = container.withDirectory(
      eslintRulesDir,
      repoRoot.directory(eslintRulesDir),
    );
  }

  // Copy all workspace package.json files for proper monorepo dependency resolution
  for (const workspace of workspaces) {
    container = container.withFile(
      `${workspace}/package.json`,
      repoRoot.file(`${workspace}/package.json`),
    );
  }

  // Copy all workspace sources BEFORE install (needed for workspace symlinks)
  for (const workspace of workspaces) {
    container = container.withDirectory(
      workspace,
      repoRoot.directory(workspace),
      {
        exclude: ["package.json", "node_modules"],
      },
    );
  }

  // Install dependencies (cached unless dependency files change)
  container = container
    .withMountedCache(
      "/root/.bun/install/cache",
      dag.cacheVolume(`bun-cache-${platform ?? "default"}`),
    )
    .withExec(["bun", "install", "--frozen-lockfile"])
    // Set working directory to the workspace
    .withWorkdir(`/workspace/${workspacePath}`);

  return container;
}
