import {
  dag,
  type Container,
  type Directory,
  type Platform,
} from "@dagger.io/dagger";
import { getSystemContainer } from "./system";
import versions from "../versions";

export type MiseToolVersions = {
  bun?: string;
  python?: string;
  node?: string;
};

/**
 * Returns a container with mise (development tools) installed and cached.
 * Optimized for maximum caching efficiency.
 *
 * @param baseContainer - The base container to build upon
 * @param toolVersions - Optional specific versions for Bun, Python, and Node
 * @returns A configured container with mise and tools ready
 */
export function withMiseTools(
  baseContainer: Container,
  toolVersions?: MiseToolVersions,
): Container {
  const bunVersion = toolVersions?.bun ?? versions.bun;
  const pythonVersion = toolVersions?.python ?? versions.python;
  const nodeVersion = toolVersions?.node ?? versions.node;

  // Cache key based on tool versions - cache invalidates when versions change
  const toolVersionKey = `mise-tools-bun${bunVersion}-python${pythonVersion}-node${nodeVersion}`;

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
      // Cache mise tools with version-specific key
      .withMountedCache(
        "/root/.local/share/mise",
        dag.cacheVolume(toolVersionKey),
      )
      // Cache pip packages
      .withMountedCache("/root/.cache/pip", dag.cacheVolume("pip-cache"))
      // Set PATH so mise shims are available
      .withEnvVariable(
        "PATH",
        "/root/.local/share/mise/shims:/root/.local/bin:${PATH}",
        {
          expand: true,
        },
      )
      // Install tools and create shims in a single cached operation
      // The version-specific cache key ensures this only runs when versions change
      .withExec([
        "sh",
        "-c",
        `mise trust --yes && mise install bun@${bunVersion} python@${pythonVersion} node@${nodeVersion} && mise use -g bun@${bunVersion} python@${pythonVersion} node@${nodeVersion} && mise reshim`,
      ])
  );
}

/**
 * Returns a container with mise development tools installed (bun, node, python).
 * This provides a consistent runtime environment with all necessary tools.
 *
 * @param platform - Optional platform specification
 * @param toolVersions - Optional specific versions for tools
 * @returns A configured container with mise and tools ready
 */
export function getMiseRuntimeContainer(
  platform?: Platform,
  toolVersions?: MiseToolVersions,
): Container {
  return withMiseTools(getSystemContainer(platform), toolVersions);
}

export type MiseContainerOptions = {
  /** Source directory to mount or copy */
  source?: Directory;
  /** Working directory inside the container */
  workdir?: string;
  /** Platform specification */
  platform?: Platform;
  /** Specific versions for Bun, Python, and Node */
  toolVersions?: MiseToolVersions;
  /** Whether to mount or copy the source directory */
  mount?: "mounted" | "copied";
};

/**
 * Returns a mise container with optional source directory handling.
 * This is a convenience wrapper that combines getMiseRuntimeContainer with
 * common patterns for mounting/copying source directories.
 *
 * @param options - Configuration options for the container
 * @returns A configured container with mise tools and optional source
 *
 * @example
 * ```ts
 * // Basic usage with mounted source
 * const container = getMiseContainer({
 *   source: dag.host().directory("."),
 *   workdir: "/workspace",
 * });
 *
 * // With copied source (for publishable images)
 * const container = getMiseContainer({
 *   source: dag.host().directory("."),
 *   mount: "copied",
 * });
 * ```
 */
export function getMiseContainer(
  options: MiseContainerOptions = {},
): Container {
  const {
    source,
    workdir = "/workspace",
    platform,
    toolVersions,
    mount = "mounted",
  } = options;

  let container = getMiseRuntimeContainer(platform, toolVersions).withWorkdir(
    workdir,
  );

  if (source) {
    container =
      mount === "mounted"
        ? container.withMountedDirectory(workdir, source)
        : container.withDirectory(workdir, source);
  }

  return container;
}

/**
 * Convenience alias for getMiseContainer.
 * Returns a mise container with bun, node, and python runtimes ready.
 *
 * @param options - Configuration options for the container
 * @returns A configured container with mise tools
 *
 * @example
 * ```ts
 * const container = getMiseBunNodeContainer({
 *   source: dag.host().directory("."),
 * });
 * await container.withExec(["bun", "install"]).sync();
 * ```
 */
export function getMiseBunNodeContainer(
  options: MiseContainerOptions = {},
): Container {
  return getMiseContainer(options);
}
