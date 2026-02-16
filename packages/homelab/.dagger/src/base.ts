import { dag, Container, Directory, type Platform } from "@dagger.io/dagger";
import versions from "./versions";

/**
 * Returns a base system container with OS packages installed (rarely changes).
 * This layer is cached independently and only rebuilds when system dependencies change.
 */
export function getSystemContainer(platform?: Platform): Container {
  return (
    dag
      .container({ platform })
      .from(`ubuntu:${versions.ubuntu}`)
      // Cache APT packages
      .withMountedCache("/var/cache/apt", dag.cacheVolume(`apt-cache-${platform ?? "default"}`))
      .withMountedCache("/var/lib/apt", dag.cacheVolume(`apt-lib-${platform ?? "default"}`))
      .withExec(["apt-get", "update"])
      .withExec(["apt-get", "install", "-y", "gpg", "wget", "curl", "git", "build-essential", "python3"])
  );
}

/**
 * Returns a container with mise development tools installed (bun, node, python).
 * This provides a consistent runtime environment with all necessary tools.
 */
export function getMiseRuntimeContainer(platform?: Platform): Container {
  return withMiseTools(getSystemContainer(platform));
}

/**
 * Creates a workspace-specific container with dependencies installed.
 * Uses Docker layer caching: copy dependency files -> install -> copy source.
 * @param repoRoot The repository root directory (must contain package.json, bun.lock, etc.)
 * @param workspacePath The path to the workspace relative to repo root (e.g., "src/ha", "src/cdk8s")
 * @param platform Optional platform specification
 * @returns A configured container with workspace dependencies installed
 */
export function getWorkspaceContainer(repoRoot: Directory, workspacePath: string, platform?: Platform): Container {
  const container = getMiseRuntimeContainer(platform)
    .withWorkdir("/workspace")
    // Copy root package.json and bun.lock for proper dependency resolution
    .withFile("package.json", repoRoot.file("package.json"))
    .withFile("bun.lock", repoRoot.file("bun.lock"))
    // Copy patches directory for bun patch support
    .withDirectory("patches", repoRoot.directory("patches"))
    // Copy root eslint config (workspace configs import from it)
    .withFile("eslint.config.ts", repoRoot.file("eslint.config.ts"))
    // Copy custom eslint rules directory (required by eslint.config.ts)
    .withDirectory("eslint-rules", repoRoot.directory("eslint-rules"))
    // Copy root prettier config (workspaces inherit from it)
    .withFile(".prettierrc", repoRoot.file(".prettierrc"))
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
      .withDirectory("src/ha", repoRoot.directory("src/ha"), { exclude: ["node_modules"] })
      .withDirectory("src/cdk8s", repoRoot.directory("src/cdk8s"), { exclude: ["node_modules"] })
      .withDirectory("src/helm-types", repoRoot.directory("src/helm-types"), { exclude: ["node_modules"] })
      .withDirectory("src/deps-email", repoRoot.directory("src/deps-email"), { exclude: ["node_modules"] })
      // Install dependencies (cached unless dependency files change)
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(`bun-cache-${platform ?? "default"}`))
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
export function getUbuntuBaseContainer(source: Directory, platform?: Platform): Container {
  return getSystemContainer(platform).withWorkdir("/workspace").withMountedDirectory("/workspace", source);
}

/**
 * Returns a cached curl container optimized for HTTP operations.
 * @returns A configured Container with curl and caching ready.
 */
export function getCurlContainer(): Container {
  return dag.container().from(`curlimages/curl:${versions["curlimages/curl"]}`);
}

/**
 * Returns a cached kubectl container optimized for Kubernetes operations.
 * @returns A configured Container with kubectl and caching ready.
 */
export function getKubectlContainer(): Container {
  return dag.container().from(`alpine/kubectl:${versions["alpine/kubectl"]}`);
}

/**
 * Returns a container with mise (development tools) installed and cached.
 * Optimized for maximum caching efficiency.
 * @param baseContainer The base container to build upon.
 * @returns A configured Container with mise and tools ready.
 */
export function withMiseTools(baseContainer: Container): Container {
  return (
    baseContainer
      // Install mise via apt (combine operations for fewer layers)
      .withExec(["install", "-dm", "755", "/etc/apt/keyrings"])
      .withExec([
        "sh",
        "-c",
        "wget -qO - https://mise.jdx.dev/gpg-key.pub | gpg --dearmor > /etc/apt/keyrings/mise-archive-keyring.gpg && " +
          "echo 'deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.gpg] https://mise.jdx.dev/deb stable main' > /etc/apt/sources.list.d/mise.list && " +
          "apt-get update && apt-get install -y mise",
      ])
      // Set PATH so mise shims are available
      .withEnvVariable("PATH", "/root/.local/share/mise/shims:/root/.local/bin:${PATH}", {
        expand: true,
      })
      // Install tools directly (no cache mount - tools must be in the final image)
      // Note: This runs every build but ensures tools are baked into the image
      .withExec([
        "sh",
        "-c",
        `mise trust --yes && mise install bun@${versions.bun} python@${versions.python} node@${versions.node} && mise use -g bun@${versions.bun} python@${versions.python} node@${versions.node} && mise reshim`,
      ])
  );
}
