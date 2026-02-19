/**
 * Homelab container builders.
 *
 * Homelab-specific containers (getWorkspaceContainer, getUbuntuBaseContainer)
 * wrap lib with homelab-specific workspace configuration.
 */
import type { Container, Directory } from "@dagger.io/dagger";
import { dag, type Platform } from "@dagger.io/dagger";
import { getSystemContainer } from "./lib-system.ts";
import { getMiseRuntimeContainer } from "./lib-mise.ts";

/**
 * Add eslint-config to a container for lint operations.
 * Mounts the eslint-config package at /eslint-config/, installs deps, builds,
 * then restores the working directory. Also mounts tsconfig.base.json at root
 * for the eslint-config's tsconfig.json extends resolution.
 *
 * The homelab root eslint.config.ts imports from "../eslint-config/local.ts"
 * which resolves to /eslint-config/local.ts from /workspace/. ESLint's jiti
 * resolver can fail with paths at the filesystem root, so we patch the import
 * to use an absolute path after building.
 */
export function withEslintConfig(
  container: Container,
  monoRepoSource: Directory,
  restoreWorkdir: string,
): Container {
  return container
    .withDirectory("/eslint-config", monoRepoSource.directory("packages/eslint-config"))
    .withFile("/tsconfig.base.json", monoRepoSource.file("tsconfig.base.json"))
    .withWorkdir("/eslint-config")
    .withExec(["bun", "install"])
    .withExec(["bun", "run", "build"])
    // Fix: ESLint's jiti/CJS resolver fails to resolve relative paths that
    // traverse to the filesystem root (../eslint-config from /workspace/).
    // Patch the import to use an absolute path instead.
    .withExec([
      "sed", "-i",
      `s|"../eslint-config/local.ts"|"/eslint-config/local.ts"|`,
      "/workspace/eslint.config.ts",
    ])
    .withWorkdir(restoreWorkdir);
}

/**
 * Creates a workspace-specific container with dependencies installed.
 * Uses Docker layer caching: copy dependency files -> install -> copy source.
 * @param repoRoot The repository root directory (must contain package.json, bun.lock, etc.)
 * @param workspacePath The path to the workspace relative to repo root (e.g., "src/ha", "src/cdk8s")
 * @param platform Optional platform specification
 * @returns A configured container with workspace dependencies installed
 */
export function getWorkspaceContainer(
  repoRoot: Directory,
  workspacePath: string,
  platform?: Platform,
): Container {
  const container = getMiseRuntimeContainer(platform)
    .withWorkdir("/workspace")
    // Copy root package.json and bun.lock for proper dependency resolution
    .withFile("package.json", repoRoot.file("package.json"))
    .withFile("bun.lock", repoRoot.file("bun.lock"))
    // Copy patches directory for bun patch support
    // Path matches patchedDependencies in package.json (relative to workspace root)
    .withDirectory("packages/homelab/patches", repoRoot.directory("patches"))
    // Copy root eslint config (workspace configs import from it)
    .withFile("eslint.config.ts", repoRoot.file("eslint.config.ts"))
    // Copy root TypeScript config (workspace configs extend from it)
    .withFile("tsconfig.base.json", repoRoot.file("tsconfig.base.json"))
    // Create stub .dagger/package.json since Dagger excludes .dagger directory by default
    // Copy the root package.json and extract just the dagger workspace package.json structure
    .withExec([
      "sh",
      "-c",
      'mkdir -p .dagger && echo \'{"name":"@homelab/dagger","type":"module","private":true}\' > .dagger/package.json',
    ]);

  return (
    container
      // Copy all workspace sources BEFORE install (needed for workspace symlinks)
      // Note: Don't exclude package.json - withDirectory replaces the target directory,
      // so excluding package.json would remove the ones we copied earlier
      .withDirectory("src/ha", repoRoot.directory("src/ha"), {
        exclude: ["node_modules"],
      })
      .withDirectory("src/cdk8s", repoRoot.directory("src/cdk8s"), {
        exclude: ["node_modules"],
      })
      .withDirectory("src/helm-types", repoRoot.directory("src/helm-types"), {
        exclude: ["node_modules"],
      })
      .withDirectory("src/deps-email", repoRoot.directory("src/deps-email"), {
        exclude: ["node_modules"],
      })
      // Install dependencies (cached unless dependency files change)
      .withMountedCache(
        "/root/.bun/install/cache",
        dag.cacheVolume(`bun-cache-${platform ?? "default"}`),
      )
      .withExec(["bun", "install", "--frozen-lockfile"])
      // Set working directory to the workspace
      .withWorkdir(`/workspace/${workspacePath}`)
  );
}

/**
 * Returns a base Ubuntu container with common tools and caching configured.
 * @param source The source directory to mount into the container at /workspace.
 * @param platform The platform to build for (optional).
 * @returns A configured Dagger Container ready for further commands.
 */
export function getUbuntuBaseContainer(
  source: Directory,
  platform?: Platform,
): Container {
  return getSystemContainer(platform)
    .withWorkdir("/workspace")
    .withMountedDirectory("/workspace", source);
}
