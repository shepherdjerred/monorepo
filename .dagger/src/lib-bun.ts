import {
  dag,
  type Container,
  type Directory,
  type Platform,
} from "@dagger.io/dagger";
import versions from "./lib-versions.ts";

/**
 * Returns a Bun container with the specified source directory mounted.
 *
 * @param source - The source directory to mount
 * @param platform - Optional platform specification
 * @param customVersion - Optional custom Bun version
 * @returns A configured container with Bun and source mounted
 */
export function getBunContainer(
  source: Directory,
  platform?: Platform,
  customVersion?: string,
): Container {
  const version = customVersion ?? versions["oven/bun"];
  return dag
    .container(platform ? { platform } : undefined)
    .from(`oven/bun:${version}`)
    .withWorkdir("/workspace")
    .withMountedDirectory("/workspace", source);
}

/**
 * Returns a Bun container with Node.js compatibility layer.
 * Useful for projects that need both Bun and Node.js APIs.
 *
 * @param source - The source directory to mount
 * @param platform - Optional platform specification
 * @param customVersion - Optional custom Bun version
 * @returns A configured container with Bun (Node compat) and source mounted
 */
export function getBunNodeContainer(
  source: Directory,
  platform?: Platform,
  customVersion?: string,
): Container {
  return getBunContainer(source, platform, customVersion).withEnvVariable(
    "BUN_FEATURE_FLAG_FORCE_NODE_ENVIRONMENT",
    "1",
  );
}
