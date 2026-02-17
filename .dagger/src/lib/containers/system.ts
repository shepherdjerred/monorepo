import { dag, type Container, type Platform } from "@dagger.io/dagger";
import versions from "../versions";

/**
 * Returns a base system container with OS packages installed (rarely changes).
 * This layer is cached independently and only rebuilds when system dependencies change.
 *
 * Uses Ubuntu as the base with common development tools pre-installed.
 *
 * @param platform - Optional platform specification (e.g., "linux/amd64")
 * @param customVersions - Optional custom versions object to override defaults
 * @returns A configured base system container
 */
export function getSystemContainer(
  platform?: Platform,
  customVersions?: { ubuntu?: string },
): Container {
  const ubuntuVersion = customVersions?.ubuntu ?? versions.ubuntu;

  return (
    dag
      .container(platform ? { platform } : undefined)
      .from(`ubuntu:${ubuntuVersion}`)
      // Cache APT packages
      .withMountedCache(
        "/var/cache/apt",
        dag.cacheVolume(`apt-cache-${platform ?? "default"}`),
      )
      .withMountedCache(
        "/var/lib/apt",
        dag.cacheVolume(`apt-lib-${platform ?? "default"}`),
      )
      .withExec(["apt-get", "update"])
      .withExec([
        "apt-get",
        "install",
        "-y",
        "gpg",
        "wget",
        "curl",
        "git",
        "build-essential",
        "python3",
        "jq",
      ])
  );
}
