import type { Directory, Secret } from "@dagger.io/dagger";
import {
  publishToGhcrMultiple,
  updateHomelabVersion,
} from "./lib/containers/index.js";

/**
 * Check starlight-karma-bot: Docker build validation
 */
export async function checkStarlightKarmaBot(
  source: Directory,
): Promise<string> {
  const pkgSource = source.directory("packages/starlight-karma-bot");

  // Build the Docker image using Dockerfile to validate it compiles
  const image = pkgSource.dockerBuild();
  await image.sync();

  return "✓ starlight-karma-bot Docker build passed";
}

/**
 * Deploy starlight-karma-bot: GHCR publish + homelab
 */
export async function deployStarlightKarmaBot(
  source: Directory,
  version: string,
  gitSha: string,
  ghcrUsername: string,
  ghcrPassword: Secret,
  ghToken: Secret,
): Promise<string> {
  const pkgSource = source.directory("packages/starlight-karma-bot");
  const outputs: string[] = [];

  const image = pkgSource.dockerBuild({
    buildArgs: [
      { name: "VERSION", value: version },
      { name: "GIT_SHA", value: gitSha },
    ],
  });

  // Push to GHCR
  await publishToGhcrMultiple({
    container: image,
    imageRefs: [
      `ghcr.io/shepherdjerred/starlight-karma-bot:${version}`,
      "ghcr.io/shepherdjerred/starlight-karma-bot:latest",
    ],
    username: ghcrUsername,
    password: ghcrPassword,
  });
  outputs.push("✓ Published to GHCR");

  // Deploy to homelab
  const deployResult = await updateHomelabVersion({
    ghToken,
    appName: "starlight-karma-bot/beta",
    version,
  });
  outputs.push(`✓ ${deployResult}`);

  return outputs.join("\n");
}
