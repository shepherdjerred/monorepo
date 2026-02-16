import { Directory, dag, type Secret, Container } from "@dagger.io/dagger";
import { getMiseRuntimeContainer } from "./base";
import type { StepResult } from ".";
import versions from "./versions";

/**
 * Builds a container with the dependency-summary script ready to run.
 * Includes: bun, git, helm (for transitive dependency detection).
 *
 * @param source The source directory.
 * @returns A configured Container ready to run the dependency-summary script.
 */
function buildDependencySummaryContainer(source: Directory): Container {
  // Get the deps-email source directory (contains main.ts)
  const depsEmailSource = source.directory("src/deps-email");

  // Get helm binary from official image
  const helmBinary = dag.container().from(`alpine/helm:${versions["alpine/helm"]}`).file("/usr/bin/helm");

  // Build the container with optimized layer caching
  return (
    getMiseRuntimeContainer()
      .withWorkdir("/app")
      // Install helm CLI (needed for transitive dependency detection)
      .withFile("/usr/local/bin/helm", helmBinary)
      .withExec(["chmod", "+x", "/usr/local/bin/helm"])
      // Copy workspace root files for proper dependency resolution
      .withFile("package.json", source.file("package.json"))
      .withFile("bun.lock", source.file("bun.lock"))
      // Copy patches directory for bun patch support
      .withDirectory("patches", source.directory("patches"))
      // Copy full workspace directories for bun workspace resolution
      .withDirectory("src/deps-email", depsEmailSource, { exclude: ["node_modules"] })
      .withDirectory("src/cdk8s", source.directory("src/cdk8s"), { exclude: ["node_modules"] })
      .withDirectory("src/helm-types", source.directory("src/helm-types"), { exclude: ["node_modules"] })
      .withDirectory("src/ha", source.directory("src/ha"), { exclude: ["node_modules"] })
      .withFile(".dagger/package.json", source.file(".dagger/package.json"))
      // Install dependencies (cached unless dependency files change)
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache-default-dep-summary"))
      .withExec(["bun", "install", "--frozen-lockfile"])
      // Set working directory to the deps-email workspace
      .withWorkdir("/app/src/deps-email")
      // Default command to run the dependency summary script
      .withDefaultArgs(["bun", "run", "src/main.ts"])
  );
}

/**
 * Builds the dependency-summary image and optionally pushes it to GHCR.
 *
 * @param source The source directory.
 * @param imageName The image name (including tag), e.g. ghcr.io/shepherdjerred/dependency-summary:latest
 * @param ghcrUsername The GHCR username
 * @param ghcrPassword The GHCR password (as a Dagger Secret)
 * @param dryRun If true, builds the image but doesn't publish it (default: false)
 * @returns The result of the build and/or push operation.
 */
export async function buildAndPushDependencySummaryImage(
  source: Directory,
  imageName = "ghcr.io/shepherdjerred/dependency-summary:latest",
  ghcrUsername: string,
  ghcrPassword: Secret,
  dryRun = false,
): Promise<StepResult> {
  const container = buildDependencySummaryContainer(source);

  // Build or publish the image based on dry-run flag
  if (dryRun) {
    // For dry-run, build the container to ensure it works
    await container.sync();
    return {
      status: "passed",
      message: "Dependency-summary image built successfully",
    };
  }

  // Publish the image
  const result = await container.withRegistryAuth("ghcr.io", ghcrUsername, ghcrPassword).publish(imageName);

  return {
    status: "passed",
    message: `Dependency-summary image published: ${result}`,
  };
}
