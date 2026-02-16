import { dag, type Container, type Directory } from "@dagger.io/dagger";
import { versions } from "@shepherdjerred/dagger-utils";

/**
 * Re-export versions from dagger-utils
 */
export { versions };

/**
 * Get a base Bun container without source mounted.
 * This allows for custom source mounting patterns.
 */
export function getBaseBunContainer(): Container {
  const bunVersion = versions["oven/bun"]?.split("@")[0] ?? "1.3.4";
  return dag
    .container()
    .from(`oven/bun:${bunVersion}`)
    .withWorkdir("/workspace");
}

/**
 * Get a Bun container with source mounted.
 */
export function getBunContainer(source: Directory): Container {
  return getBaseBunContainer().withMountedDirectory("/workspace", source);
}
