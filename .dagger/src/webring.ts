import type { Directory, Container, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { syncToS3 } from "./lib-s3.ts";
import versions from "./lib-versions.ts";

function getWebringContainer(source: Directory): Container {
  return dag
    .container()
    .from(`oven/bun:${versions["oven/bun"]}`)
    .withWorkdir("/workspace")
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    // Root workspace files for bun install (strip workspaces to avoid resolving missing members)
    .withFile("/workspace/package.json", source.file("package.json"))
    .withFile("/workspace/bun.lock", source.file("bun.lock"))
    .withExec([
      "bun",
      "-e",
      `const pkg = JSON.parse(await Bun.file('/workspace/package.json').text()); pkg.workspaces = ['packages/webring', 'packages/eslint-config']; await Bun.write('/workspace/package.json', JSON.stringify(pkg));`,
    ])
    // Package source
    .withDirectory(
      "/workspace/packages/webring",
      source.directory("packages/webring"),
      {
        exclude: [
          "node_modules",
          "dist",
          "build",
          ".cache",
          ".dagger",
          "generated",
        ],
      },
    )
    // Eslint config (needed for lint — ../eslint-config/local.ts)
    .withDirectory(
      "/workspace/packages/eslint-config",
      source.directory("packages/eslint-config"),
    )
    .withWorkdir("/workspace")
    .withExec(["bun", "install"])
    .withWorkdir("/workspace/packages/webring");
}

/**
 * Check webring: lint, build, test (with example app)
 */
export async function checkWebring(source: Directory): Promise<string> {
  const container = getWebringContainer(source);

  // Lint and build in parallel
  await Promise.all([
    container.withExec(["bun", "run", "lint"]).sync(),
    container.withExec(["bun", "run", "build"]).sync(),
  ]);

  // Test after build (needs built dist)
  const buildDir = container
    .withExec(["bun", "run", "build"])
    .directory("dist");

  // Run unit tests
  await container.withExec(["bun", "run", "test", "--", "--run"]).sync();

  // Test example app with workaround for symlink issues
  const exampleContainer = getWebringContainer(source)
    .withDirectory("dist", buildDir)
    .withWorkdir("/workspace/packages/webring/example")
    .withExec([
      "bun",
      "-e",
      "const pkg = JSON.parse(await Bun.file('package.json').text()); delete pkg.dependencies.webring; await Bun.write('package.json', JSON.stringify(pkg, null, 2));",
    ])
    .withExec(["bun", "install"])
    .withExec(["mkdir", "-p", "node_modules/webring/dist"])
    .withExec(["cp", "-r", "../dist/.", "node_modules/webring/dist/"])
    .withExec(["cp", "../package.json", "node_modules/webring/"]);

  await exampleContainer.withExec(["bun", "run", "build"]).sync();

  return "✓ webring CI passed (lint, build, test, example)";
}

/**
 * Deploy webring docs to S3
 */
export async function deployWebringDocs(
  source: Directory,
  s3AccessKeyId: Secret,
  s3SecretAccessKey: Secret,
): Promise<string> {
  const container = getWebringContainer(source);

  const docsDir = container
    .withExec(["bun", "run", "typedoc"])
    .directory("docs");

  const syncOutput = await syncToS3({
    sourceDir: docsDir,
    bucketName: "webring",
    endpointUrl: "https://seaweedfs.sjer.red",
    accessKeyId: s3AccessKeyId,
    secretAccessKey: s3SecretAccessKey,
    region: "us-east-1",
    deleteRemoved: true,
  });

  return `✓ webring docs deployed to S3\n${syncOutput}`;
}
