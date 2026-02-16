import { dag, type Secret } from "@dagger.io/dagger";
import type { StepResult } from ".";
import { caddyVersionOnly } from "./versions";

/**
 * Builds a Caddy container with the s3proxy plugin.
 * Uses xcaddy to compile Caddy with the plugin in a builder stage,
 * then copies the binary to a minimal alpine runtime.
 */
function buildCaddyS3ProxyContainer() {
  // Build stage: use caddy builder image which has xcaddy
  // Use version-only (no digest) because variant tags have different digests than the base image
  const builder = dag
    .container()
    .from(`caddy:${caddyVersionOnly}-builder-alpine`)
    .withExec(["xcaddy", "build", "--with", "github.com/lindenlab/caddy-s3-proxy"]);

  // Get the built caddy binary
  const caddyBinary = builder.file("caddy");

  // Runtime stage: minimal caddy alpine image with our custom binary
  return dag.container().from(`caddy:${caddyVersionOnly}-alpine`).withFile("/usr/bin/caddy", caddyBinary);
}

/**
 * Builds the caddy-s3proxy image and optionally pushes it to GHCR.
 *
 * @param imageName The image name (including tag), e.g. ghcr.io/shepherdjerred/caddy-s3proxy:latest
 * @param ghcrUsername The GHCR username
 * @param ghcrPassword The GHCR password (as a Dagger Secret)
 * @param dryRun If true, builds the image but doesn't publish it (default: false)
 * @returns The result of the build and/or push operation.
 */
export async function buildAndPushCaddyS3ProxyImage(
  imageName = "ghcr.io/shepherdjerred/caddy-s3proxy:latest",
  ghcrUsername: string,
  ghcrPassword: Secret,
  dryRun = false,
): Promise<StepResult> {
  const container = buildCaddyS3ProxyContainer();

  if (dryRun) {
    await container.sync();
    return {
      status: "passed",
      message: "Image built successfully",
    };
  }

  const result = await container.withRegistryAuth("ghcr.io", ghcrUsername, ghcrPassword).publish(imageName);

  return {
    status: "passed",
    message: `Image published: ${result}`,
  };
}
