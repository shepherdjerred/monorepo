import type { Directory, Container, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import {
  syncToS3,
  publishToGhcrMultiple,
} from "./lib/containers/index.js";

const BUN_VERSION = "1.3.4";

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
    // Main app lint
    getBscContainer()
      .withMountedDirectory("/workspace", mainSource)
      .withExec(["bun", "install", "--frozen-lockfile"])
      .withExec(["bun", "run", "lint:fix"])
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
export async function deployBetterSkillCapped(
  source: Directory,
  version: string,
  s3AccessKeyId: Secret,
  s3SecretAccessKey: Secret,
  ghcrUsername: string,
  ghcrPassword: Secret,
  _ghToken: Secret,
): Promise<string> {
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
