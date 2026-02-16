import type { Directory, Container, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { syncToS3 } from "./lib/containers/index.js";

function getWebringContainer(pkgSource: Directory): Container {
  return dag
    .container()
    .from("oven/bun:latest")
    .withWorkdir("/workspace")
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    .withDirectory("/workspace", pkgSource, {
      exclude: ["node_modules", "dist", "build", ".cache", ".dagger", "generated"],
    })
    .withExec(["bun", "install", "--frozen-lockfile"]);
}

/**
 * Check webring: lint, build, test (with example app)
 */
export async function checkWebring(source: Directory): Promise<string> {
  const pkgSource = source.directory("packages/webring");
  const container = getWebringContainer(pkgSource);

  // Lint and build in parallel
  await Promise.all([
    container.withExec(["bun", "run", "lint"]).sync(),
    container.withExec(["bun", "run", "build"]).sync(),
  ]);

  // Test after build (needs built dist)
  const buildDir = container.withExec(["bun", "run", "build"]).directory("dist");

  // Run unit tests
  await container.withExec(["bun", "run", "test", "--", "--run"]).sync();

  // Test example app with workaround for symlink issues
  const exampleContainer = getWebringContainer(pkgSource)
    .withDirectory("dist", buildDir)
    .withWorkdir("/workspace/example")
    .withExec([
      "bun", "-e",
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
  const pkgSource = source.directory("packages/webring");
  const container = getWebringContainer(pkgSource);

  const docsDir = container.withExec(["bun", "run", "typedoc"]).directory("docs");

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
