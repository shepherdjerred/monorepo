import { Directory, dag, type Secret, Container, type File } from "@dagger.io/dagger";
import { getWorkspaceContainer, getMiseRuntimeContainer } from "./base";
import { execOrThrow } from "./errors";
import type { StepResult } from ".";
import versions from "./versions";

/**
 * Prepares the HA container by generating hass.d.ts if needed.
 * If src/ha/src/hass/ exists, skips generation and uses existing files.
 * Otherwise, requires HA credentials to generate types.
 * This is the shared container setup for all HA operations.
 */
export async function prepareHaContainer(
  source: Directory,
  hassBaseUrl?: Secret,
  hassToken?: Secret,
): Promise<Container> {
  let container = getWorkspaceContainer(source, "src/ha");

  // Check if hass directory already exists by looking at the parent directory entries
  const haSourceDir = source.directory("src/ha/src");
  const entries = await haSourceDir.entries();
  const hasExistingTypes = entries.includes("hass");

  if (hasExistingTypes) {
    console.log("✅ Using existing @hass/ types from src/ha/src/hass/");
    // Skip type generation, types already exist
    return container;
  }

  // Types don't exist, need to generate them
  if (!hassBaseUrl || !hassToken) {
    throw new Error(
      "HASS_BASE_URL and HASS_TOKEN are required when src/ha/src/hass/ does not exist. " +
        "Either provide the secrets or commit the generated types to the repository.",
    );
  }

  console.log("🔄 Generating @hass/ types using provided credentials...");
  container = container
    .withSecretVariable("HASS_BASE_URL", hassBaseUrl)
    .withSecretVariable("HASS_TOKEN", hassToken)
    .withExec(["bun", "generate-types.ts"]);

  return container;
}

export function buildHa(source: Directory): Directory {
  return getWorkspaceContainer(source, "src/ha").withExec(["bun", "run", "build"]).directory("/workspace/src/ha");
}

/**
 * Builds the HA app using a pre-prepared container.
 * Use this when you already have a prepared container from prepareHaContainer().
 */
export function buildHaWithContainer(container: Container): Directory {
  return container.withExec(["bun", "run", "build"]).directory("/workspace/src/ha");
}

export async function typeCheckHa(source: Directory, hassBaseUrl?: Secret, hassToken?: Secret): Promise<string> {
  const container = await prepareHaContainer(source, hassBaseUrl, hassToken);
  return execOrThrow(container, ["bun", "run", "typecheck"]);
}

/**
 * Runs type check using a pre-prepared container.
 */
export function typeCheckHaWithContainer(container: Container): Promise<string> {
  return execOrThrow(container, ["bun", "run", "typecheck"]);
}

export async function lintHa(source: Directory, hassBaseUrl?: Secret, hassToken?: Secret): Promise<string> {
  const container = await prepareHaContainer(source, hassBaseUrl, hassToken);
  return execOrThrow(container, ["bun", "run", "lint"]);
}

/**
 * Runs lint using a pre-prepared container.
 */
export function lintHaWithContainer(container: Container): Promise<string> {
  return execOrThrow(container, ["bun", "run", "lint"]);
}

/**
 * Builds a container with the HA application ready to run.
 * Uses improved caching for better build performance.
 *
 * @param source The source directory.
 * @returns A configured Container ready to run the HA application.
 */
function buildHaContainer(source: Directory): Container {
  // Get just the HA source directory
  const haSource = source.directory("src/ha");

  // Build the container with optimized layer caching
  // Use getMiseRuntimeContainer() instead of withMiseTools(getUbuntuBaseContainer(source))
  // to avoid invalidating mise layer when source files change
  return (
    getMiseRuntimeContainer()
      .withWorkdir("/app")
      .withExec(["bun", "install", "node-gyp"])
      // Copy workspace root files for proper dependency resolution
      .withFile("package.json", source.file("package.json"))
      .withFile("bun.lock", source.file("bun.lock"))
      // Copy patches directory for bun patch support
      .withDirectory("patches", source.directory("patches"))
      // Copy full workspace directories for bun workspace resolution
      .withDirectory("src/ha", haSource, { exclude: ["node_modules"] })
      .withDirectory("src/cdk8s", source.directory("src/cdk8s"), { exclude: ["node_modules"] })
      .withDirectory("src/helm-types", source.directory("src/helm-types"), { exclude: ["node_modules"] })
      .withDirectory("src/deps-email", source.directory("src/deps-email"), { exclude: ["node_modules"] })
      .withFile(".dagger/package.json", source.file(".dagger/package.json"))
      // Install dependencies (cached unless dependency files change)
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache-default-ha"))
      .withExec(["bun", "install", "--frozen-lockfile"])
      // Set working directory to the ha workspace
      .withWorkdir("/app/src/ha")
      // Expose metrics port
      .withExposedPort(9090)
      .withDefaultArgs(["mise", "exec", `bun@${versions.bun}`, "--", "bun", "src/main.ts"])
  );
}

/**
 * Builds the HA image and exports it to a tar file for testing.
 * Uses caching for improved build performance.
 *
 * @param source The source directory.
 * @returns The exported tar file
 */
export function buildAndExportHaImage(source: Directory): File {
  const container = buildHaContainer(source);
  return container.asTarball();
}

/**
 * Builds the HA image and optionally pushes it to GHCR.
 * Uses caching for improved build performance.
 *
 * @param source The source directory.
 * @param imageName The image name (including tag), e.g. ghcr.io/shepherdjerred/homelab:latest
 * @param ghcrUsername The GHCR username
 * @param ghcrPassword The GHCR password (as a string, should be passed as a secret from the CLI or environment)
 * @param dryRun If true, builds the image but doesn't publish it (default: false)
 * @returns The result of the build and/or push operation.
 */
export async function buildAndPushHaImage(
  source: Directory,
  imageName = "ghcr.io/shepherdjerred/homelab:latest",
  ghcrUsername: string,
  ghcrPassword: Secret,
  dryRun = false,
): Promise<StepResult> {
  const container = buildHaContainer(source);

  // Build or publish the image based on dry-run flag
  if (dryRun) {
    // For dry-run, build the container to ensure it works
    await container.sync();
    return {
      status: "passed",
      message: "Image built successfully",
    };
  }
  // Publish the image
  const result = await container.withRegistryAuth("ghcr.io", ghcrUsername, ghcrPassword).publish(imageName);

  return {
    status: "passed",
    message: `Image published: ${result}`,
  };
}
