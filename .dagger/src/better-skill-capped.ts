import type { Directory, Container, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { syncToS3 } from "./lib-s3.ts";
import { publishToGhcrMultiple } from "./lib-ghcr.ts";
import versions from "./lib-versions.ts";

const BUN_VERSION = versions.bun;

function getBscContainer(): Container {
  return dag
    .container()
    .from(`oven/bun:${BUN_VERSION}`)
    .withWorkdir("/workspace")
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"));
}

/**
 * Check better-skill-capped: lint + build (main app), build (fetcher)
 */
export async function checkBetterSkillCapped(
  source: Directory,
): Promise<string> {
  const pkgSource = source.directory("packages/better-skill-capped");
  const mainSource = pkgSource.withoutDirectory("fetcher");
  const fetcherSource = pkgSource.directory("fetcher");

  // Run lint, build (main), and fetcher build in parallel
  await Promise.all([
    // Main app lint — needs workspace structure for eslint-config
    getBscContainer()
      .withFile("/workspace/package.json", source.file("package.json"))
      .withFile("/workspace/bun.lock", source.file("bun.lock"))
      .withExec([
        "bun",
        "-e",
        `const pkg = JSON.parse(await Bun.file('/workspace/package.json').text()); pkg.workspaces = ['packages/better-skill-capped', 'packages/eslint-config']; await Bun.write('/workspace/package.json', JSON.stringify(pkg));`,
      ])
      .withDirectory("/workspace/packages/better-skill-capped", mainSource)
      .withDirectory(
        "/workspace/packages/eslint-config",
        source.directory("packages/eslint-config"),
      )
      .withWorkdir("/workspace")
      .withExec(["bun", "install"])
      .withWorkdir("/workspace/packages/eslint-config")
      .withExec(["bun", "run", "build"])
      .withWorkdir("/workspace/packages/better-skill-capped")
      .withExec(["bun", "run", "lint"])
      .sync(),
    // Main app build
    getBscContainer()
      .withMountedDirectory("/workspace", mainSource)
      .withExec(["bun", "install", "--frozen-lockfile"])
      .withExec(["bun", "run", "build"])
      .sync(),
    // Fetcher build
    getBscContainer()
      .withMountedDirectory("/workspace", fetcherSource)
      .withExec(["bun", "install", "--frozen-lockfile"])
      .withExec(["bun", "run", "build"])
      .sync(),
  ]);

  return "✓ better-skill-capped CI passed (lint, build, fetcher build)";
}

/**
 * Deploy better-skill-capped: S3 frontend + GHCR fetcher + homelab
 */
type DeployBetterSkillCappedOptions = {
  source: Directory;
  version: string;
  s3AccessKeyId: Secret;
  s3SecretAccessKey: Secret;
  ghcrUsername: string;
  ghcrPassword: Secret;
};

export async function deployBetterSkillCapped(
  options: DeployBetterSkillCappedOptions,
): Promise<string> {
  const { source, version, s3AccessKeyId, s3SecretAccessKey, ghcrUsername, ghcrPassword } = options;
  const pkgSource = source.directory("packages/better-skill-capped");
  const mainSource = pkgSource.withoutDirectory("fetcher");
  const fetcherSource = pkgSource.directory("fetcher");
  const outputs: string[] = [];

  // Build and deploy frontend to S3
  const buildContainer = getBscContainer()
    .withDirectory("/workspace", mainSource)
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withExec(["bun", "run", "build"]);
  const dist = buildContainer.directory("/workspace/dist");

  const syncOutput = await syncToS3({
    sourceDir: dist,
    bucketName: "better-skill-capped",
    endpointUrl: "https://seaweedfs.sjer.red",
    accessKeyId: s3AccessKeyId,
    secretAccessKey: s3SecretAccessKey,
    region: "us-east-1",
    deleteRemoved: true,
  });
  outputs.push(`✓ Frontend deployed to S3\n${syncOutput}`);

  // Build and publish fetcher container to GHCR
  const fetcherContainer = getBscContainer()
    .withDirectory("/workspace", fetcherSource)
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withEntrypoint(["bun", "run", "src/index.ts"]);

  const fetcherImage = "ghcr.io/shepherdjerred/better-skill-capped-fetcher";
  await publishToGhcrMultiple({
    container: fetcherContainer,
    imageRefs: [`${fetcherImage}:${version}`, `${fetcherImage}:latest`],
    username: ghcrUsername,
    password: ghcrPassword,
  });
  outputs.push("✓ Fetcher published to GHCR");

  return outputs.join("\n");
}
