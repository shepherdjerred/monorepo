import type { Directory, Container, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { syncToS3 } from "./lib-s3.ts";
import versions from "./lib-versions.ts";

function getBunContainer(): Container {
  return dag
    .container()
    .from(`oven/bun:${versions["oven/bun"]}`)
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
    .withExec(["sh", "-c", `curl -fsSL https://bun.sh/install | bash -s "bun-v${versions.bun}"`])
    .withEnvVariable("PATH", "/root/.bun/bin:$PATH", { expand: true });
}

/**
 * Install sjer.red with webring as a workspace dependency.
 * webring is a local workspace package that must be built from source
 * (the npm version may have stale types or missing declarations).
 */
function installDepsWithWebring(
  baseContainer: Container,
  source: Directory,
  pkgSource: Directory,
): Container {
  return baseContainer
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    .withFile("/workspace/package.json", source.file("package.json"))
    .withExec([
      "bun",
      "-e",
      `const pkg = JSON.parse(await Bun.file('/workspace/package.json').text()); pkg.workspaces = ['packages/sjer.red', 'packages/webring']; await Bun.write('/workspace/package.json', JSON.stringify(pkg));`,
    ])
    // Exclude sjer.red's own bun.lock — it resolves webring from npm.
    // Without any lockfile, bun generates fresh workspace resolution.
    .withDirectory("/workspace/packages/sjer.red", pkgSource.withoutFile("bun.lock"))
    .withDirectory(
      "/workspace/packages/webring",
      source.directory("packages/webring"),
    )
    .withWorkdir("/workspace")
    .withExec(["bun", "install"])
    .withWorkdir("/workspace/packages/webring")
    .withExec(["bun", "run", "build"])
    .withWorkdir("/workspace/packages/sjer.red");
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
    // Lint (Bun container with workspace structure for eslint-config)
    getBunContainer()
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
      .withFile("/workspace/package.json", source.file("package.json"))
      .withExec([
        "bun",
        "-e",
        `const pkg = JSON.parse(await Bun.file('/workspace/package.json').text()); pkg.workspaces = ['packages/sjer.red', 'packages/eslint-config', 'packages/webring']; await Bun.write('/workspace/package.json', JSON.stringify(pkg));`,
      ])
      .withDirectory("/workspace/packages/sjer.red", ciSource.withoutFile("bun.lock"))
      .withDirectory(
        "/workspace/packages/eslint-config",
        source.directory("packages/eslint-config"),
      )
      .withDirectory(
        "/workspace/packages/webring",
        source.directory("packages/webring"),
      )
      .withFile("/workspace/tsconfig.base.json", source.file("tsconfig.base.json"))
      .withWorkdir("/workspace")
      .withExec(["bun", "install"])
      .withWorkdir("/workspace/packages/eslint-config")
      .withExec(["bun", "run", "build"])
      .withWorkdir("/workspace/packages/webring")
      .withExec(["bun", "run", "build"])
      .withWorkdir("/workspace/packages/sjer.red")
      .withExec(["bunx", "astro", "sync"])
      .withExec(["bun", "run", "lint"])
      .sync(),
    // Build (Playwright container for OG images)
    installDepsWithWebring(getPlaywrightContainer(), source, ciSource)
      .withMountedCache("/webring-cache", dag.cacheVolume("webring-cache"))
      .withEnvVariable("WEBRING_CACHE_DIR", "/webring-cache")
      .withExec(["bun", "run", "build"])
      .sync(),
    // Test (Playwright container)
    (async () => {
      // Build first (needed for test)
      const buildContainer = installDepsWithWebring(getPlaywrightContainer(), source, pkgSource)
        .withMountedCache("/webring-cache", dag.cacheVolume("webring-cache"))
        .withEnvVariable("WEBRING_CACHE_DIR", "/webring-cache")
        .withExec(["bun", "run", "build"]);
      const distDir = buildContainer.directory("/workspace/packages/sjer.red/dist");

      // Then run tests with pre-built dist
      await installDepsWithWebring(getPlaywrightContainer(), source, pkgSource)
        .withDirectory("/workspace/packages/sjer.red/dist", distDir)
        .withEnvVariable("CI", "true")
        .withExec([
          "bun",
          "run",
          "test",
          "--project=chromium",
          "--max-failures=1",
          "--ignore-snapshots",
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

  const buildContainer = installDepsWithWebring(getPlaywrightContainer(), source, pkgSource)
    .withMountedCache("/webring-cache", dag.cacheVolume("webring-cache"))
    .withEnvVariable("WEBRING_CACHE_DIR", "/webring-cache")
    .withExec(["bun", "run", "build"]);
  const distDir = buildContainer.directory("/workspace/packages/sjer.red/dist");

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
