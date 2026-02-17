import type { Directory, Container, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { syncToS3 } from "./lib/containers/index.js";

function getBunContainer(): Container {
  return dag
    .container()
    .from("oven/bun:latest")
    .withWorkdir("/workspace")
    .withEnvVariable("PUPPETEER_SKIP_DOWNLOAD", "1");
}

function getPlaywrightContainer(): Container {
  return dag
    .container()
    .from("mcr.microsoft.com/playwright:v1.57.0-noble")
    .withWorkdir("/workspace")
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "unzip"])
    .withExec(["sh", "-c", "curl -fsSL https://bun.sh/install | bash"])
    .withEnvVariable("PATH", "/root/.bun/bin:$PATH", { expand: true });
}

function installDeps(
  baseContainer: Container,
  pkgSource: Directory,
): Container {
  return baseContainer
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    .withDirectory("/workspace", pkgSource)
    .withExec(["bun", "install", "--frozen-lockfile"]);
}

/**
 * Check sjer.red: lint, build (Playwright), test (Playwright)
 */
export async function checkSjerRed(source: Directory): Promise<string> {
  const pkgSource = source.directory("packages/sjer.red");
  // Exclude test snapshots for CI (they're only needed for visual regression)
  const ciSource = pkgSource.withoutDirectory("test/index.spec.ts-snapshots");

  // Run lint, test, and build in parallel
  await Promise.all([
    // Lint (simple Bun container)
    installDeps(getBunContainer(), ciSource)
      .withExec(["bunx", "astro", "sync"])
      .withExec(["bun", "run", "lint"])
      .sync(),
    // Build (Playwright container for OG images)
    installDeps(getPlaywrightContainer(), ciSource)
      .withMountedCache("/webring-cache", dag.cacheVolume("webring-cache"))
      .withEnvVariable("WEBRING_CACHE_DIR", "/webring-cache")
      .withExec(["bun", "run", "build"])
      .sync(),
    // Test (Playwright container)
    (async () => {
      // Build first (needed for test)
      const buildContainer = installDeps(getPlaywrightContainer(), pkgSource)
        .withMountedCache("/webring-cache", dag.cacheVolume("webring-cache"))
        .withEnvVariable("WEBRING_CACHE_DIR", "/webring-cache")
        .withExec(["bun", "run", "build"]);
      const distDir = buildContainer.directory("/workspace/dist");

      // Then run tests
      await installDeps(getPlaywrightContainer(), pkgSource)
        .withDirectory("/workspace/dist", distDir)
        .withEnvVariable("CI", "true")
        .withExec([
          "bun",
          "run",
          "test",
          "--project=chromium",
          "--max-failures=1",
        ])
        .sync();
    })(),
  ]);

  return "✓ sjer.red CI passed (lint, build, test)";
}

/**
 * Deploy sjer.red to S3
 */
export async function deploySjerRed(
  source: Directory,
  s3AccessKeyId: Secret,
  s3SecretAccessKey: Secret,
): Promise<string> {
  const pkgSource = source.directory("packages/sjer.red");

  const buildContainer = installDeps(getPlaywrightContainer(), pkgSource)
    .withMountedCache("/webring-cache", dag.cacheVolume("webring-cache"))
    .withEnvVariable("WEBRING_CACHE_DIR", "/webring-cache")
    .withExec(["bun", "run", "build"]);
  const distDir = buildContainer.directory("/workspace/dist");

  const syncOutput = await syncToS3({
    sourceDir: distDir,
    bucketName: "sjer-red",
    endpointUrl: "https://seaweedfs.sjer.red",
    accessKeyId: s3AccessKeyId,
    secretAccessKey: s3SecretAccessKey,
    region: "us-east-1",
    deleteRemoved: true,
  });

  return `✓ sjer.red deployed to S3\n${syncOutput}`;
}
