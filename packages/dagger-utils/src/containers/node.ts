import { dag, type Container, type Directory, type Platform } from "@dagger.io/dagger";
import versions from "../versions";

/**
 * Returns a Node.js container with the specified source directory mounted.
 *
 * @param source - Optional source directory to mount
 * @param platform - Optional platform specification
 * @param customVersion - Optional custom Node.js version
 * @returns A configured container with Node.js
 */
export function getNodeContainer(
  source?: Directory,
  platform?: Platform,
  customVersion?: string,
): Container {
  const version = customVersion ?? versions.node;
  let container = dag
    .container(platform ? { platform } : undefined)
    .from(`node:${version}`)
    .withWorkdir("/workspace");

  if (source !== undefined) {
    container = container.withMountedDirectory("/workspace", source);
  }

  return container;
}

/**
 * Returns a slim Node.js container (smaller image size).
 *
 * @param source - Optional source directory to mount
 * @param platform - Optional platform specification
 * @param customVersion - Optional custom Node.js version
 * @returns A configured slim Node.js container
 */
export function getNodeSlimContainer(
  source?: Directory,
  platform?: Platform,
  customVersion?: string,
): Container {
  const version = customVersion ?? versions.node;
  let container = dag
    .container(platform ? { platform } : undefined)
    .from(`node:${version}-slim`)
    .withWorkdir("/workspace");

  if (source !== undefined) {
    container = container.withMountedDirectory("/workspace", source);
  }

  return container;
}

/**
 * Returns a Node.js container with npm cache mounted for faster installs.
 *
 * @param source - Source directory to mount
 * @param platform - Optional platform specification
 * @param customVersion - Optional custom Node.js version
 * @returns A configured container with npm cache
 */
export function getNodeContainerWithCache(
  source: Directory,
  platform?: Platform,
  customVersion?: string,
): Container {
  return getNodeContainer(source, platform, customVersion)
    .withMountedCache("/root/.npm", dag.cacheVolume("npm-cache"));
}

export type NodeCacheOptions = {
  /** Cache volume key (default: "npm-cache") */
  cacheKey?: string;
  /** Path to mount the cache (default: "/root/.npm") */
  cachePath?: string;
};

/**
 * Adds npm cache mounting to a container for faster npm installs.
 * This is a composable helper that can be applied to any container.
 *
 * @param container - The container to add npm cache to
 * @param options - Configuration options for the cache
 * @returns The container with npm cache mounted
 *
 * @example
 * ```ts
 * const container = withNpmCache(
 *   getNodeContainer(source),
 *   { cacheKey: "my-project-npm" }
 * );
 * ```
 */
export function withNpmCache(container: Container, options: NodeCacheOptions = {}): Container {
  const { cacheKey = "npm-cache", cachePath = "/root/.npm" } = options;
  return container.withMountedCache(cachePath, dag.cacheVolume(cacheKey));
}
