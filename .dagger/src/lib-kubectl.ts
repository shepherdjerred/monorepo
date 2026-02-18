import { dag, type Container } from "@dagger.io/dagger";
import versions from "./lib-versions.ts";

/**
 * Returns a cached kubectl container optimized for Kubernetes operations.
 *
 * @param customVersion - Optional custom version to override default
 * @returns A configured container with kubectl ready
 */
export function getKubectlContainer(customVersion?: string): Container {
  const version = customVersion ?? versions["alpine/kubectl"];
  return dag.container().from(`alpine/kubectl:${version}`);
}
