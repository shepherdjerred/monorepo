import { dag, type Container } from "@dagger.io/dagger";
import versions from "../versions";

/**
 * Returns a cached curl container optimized for HTTP operations.
 *
 * @param customVersion - Optional custom version to override default
 * @returns A configured container with curl ready
 */
export function getCurlContainer(customVersion?: string): Container {
  const version = customVersion ?? versions["curlimages/curl"];
  return dag.container().from(`curlimages/curl:${version}`);
}
