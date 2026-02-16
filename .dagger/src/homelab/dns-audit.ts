import { dag, type Secret } from "@dagger.io/dagger";
import type { StepResult } from ".";

/**
 * Builds a Python container with checkdmarc pre-installed.
 * Used by the dns-audit CronJob to avoid installing checkdmarc at runtime.
 */
function buildDnsAuditContainer() {
  return dag
    .container()
    .from("python:3.12-slim")
    .withExec(["pip", "install", "--no-cache-dir", "checkdmarc"])
    .withDefaultArgs(["python3"]);
}

/**
 * Builds the dns-audit image and optionally pushes it to GHCR.
 *
 * @param imageName The image name (including tag), e.g. ghcr.io/shepherdjerred/dns-audit:latest
 * @param ghcrUsername The GHCR username
 * @param ghcrPassword The GHCR password (as a Dagger Secret)
 * @param dryRun If true, builds the image but doesn't publish it (default: false)
 * @returns The result of the build and/or push operation.
 */
export async function buildAndPushDnsAuditImage(
  imageName = "ghcr.io/shepherdjerred/dns-audit:latest",
  ghcrUsername: string,
  ghcrPassword: Secret,
  dryRun = false,
): Promise<StepResult> {
  const container = buildDnsAuditContainer();

  if (dryRun) {
    await container.sync();
    return {
      status: "passed",
      message: "Dns-audit image built successfully",
    };
  }

  const result = await container.withRegistryAuth("ghcr.io", ghcrUsername, ghcrPassword).publish(imageName);

  return {
    status: "passed",
    message: `Dns-audit image published: ${result}`,
  };
}
