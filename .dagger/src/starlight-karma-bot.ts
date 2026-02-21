import type { Directory, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { publishToGhcrMultiple } from "./lib-ghcr.ts";
import { execOrThrow } from "./lib-errors.ts";
import versions from "./lib-versions.ts";

const BUN_VERSION = versions.bun;

/**
 * Check starlight-karma-bot: Docker build validation + prettier
 */
export async function checkStarlightKarmaBot(
  source: Directory,
): Promise<string> {
  const pkgSource = source.directory("packages/starlight-karma-bot");

  // Run Docker build and prettier check in parallel
  const prettierContainer = dag
    .container()
    .from(`oven/bun:${BUN_VERSION}`)
    .withMountedDirectory("/workspace", pkgSource)
    .withWorkdir("/workspace")
    .withExec(["bun", "install"]);

  await Promise.all([
    pkgSource.dockerBuild().sync(),
    execOrThrow(prettierContainer, ["bunx", "prettier", "--check", "."]),
  ]);

  return "✓ starlight-karma-bot Docker build + prettier passed";
}

/**
 * Deploy starlight-karma-bot: GHCR publish + homelab
 */
type DeployStarlightKarmaBotOptions = {
  source: Directory;
  version: string;
  gitSha: string;
  ghcrUsername: string;
  ghcrPassword: Secret;
};

export async function deployStarlightKarmaBot(
  options: DeployStarlightKarmaBotOptions,
): Promise<{ message: string; versionedRef: string }> {
  const { source, version, gitSha, ghcrUsername, ghcrPassword } = options;
  const pkgSource = source.directory("packages/starlight-karma-bot");
  const outputs: string[] = [];

  const image = pkgSource.dockerBuild({
    buildArgs: [
      { name: "VERSION", value: version },
      { name: "GIT_SHA", value: gitSha },
    ],
  });

  // Push to GHCR
  const refs = await publishToGhcrMultiple({
    container: image,
    imageRefs: [
      `ghcr.io/shepherdjerred/starlight-karma-bot:${version}`,
      "ghcr.io/shepherdjerred/starlight-karma-bot:latest",
    ],
    username: ghcrUsername,
    password: ghcrPassword,
  });
  outputs.push("✓ Published to GHCR");

  return { message: outputs.join("\n"), versionedRef: refs[0] ?? "" };
}
