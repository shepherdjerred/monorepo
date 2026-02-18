import {
  dag,
  type Container,
  type Platform,
} from "@dagger.io/dagger";
import { getSystemContainer } from "./lib-system.ts";
import versions from "./lib-versions.ts";

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

