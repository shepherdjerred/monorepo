import type { Directory, Secret } from "@dagger.io/dagger";
import { syncToS3 } from "./lib-s3.ts";
import { publishToGhcrMultiple } from "./lib-ghcr.ts";
import { logWithTimestamp, withTiming } from "./lib-timing.ts";
import { execOrThrow } from "./lib-errors.ts";
import {
  generatePrismaClient,
  getPreparedWorkspace,
  buildBackendImage,
  smokeTestBackendImageWithContainer,
  buildFrontend,
} from "./scout-for-lol-helpers.ts";
import {
  buildDesktopFrontend,
  checkDesktopParallel,
  buildDesktopWindowsGnu,
  publishDesktopArtifactsWindowsOnly,
} from "./scout-for-lol-desktop.ts";

/**
 * Run all checks for scout-for-lol: typecheck, lint, test, duplication, desktop checks.
 * Extracts the scout-for-lol package from the monorepo source and uses the
 * nested workspace's own bun.lock for dependency resolution.
 */
export async function checkScoutForLol(source: Directory): Promise<string> {
  const pkgSource = source.directory("packages/scout-for-lol");
  const eslintConfigSource = source.directory("packages/eslint-config");
  const tsconfigBase = source.file("tsconfig.base.json");

  logWithTimestamp("Starting comprehensive check process for scout-for-lol");

  // Generate Prisma client once and share
  const prismaGenerated = generatePrismaClient(pkgSource);

  // Use embedded workspace for CI checks (simpler DAG, avoids engine issues)
  // Mount eslint-config at /eslint-config/ (eslint.config.ts imports from ../eslint-config/local.ts)
  const preparedWorkspace = getPreparedWorkspace(
    pkgSource,
    prismaGenerated,
  )
    .withDirectory("/eslint-config", eslintConfigSource)
    .withFile("/tsconfig.base.json", tsconfigBase)
    .withWorkdir("/eslint-config")
    .withExec(["bun", "install"])
    .withExec(["bun", "run", "build"])
    .withWorkdir("/workspace")
    // Fix jiti/CJS resolver: rewrite relative import that traverses to filesystem root
    .withExec([
      "sed", "-i",
      `s|"../eslint-config/local.ts"|"/eslint-config/local.ts"|`,
      "/workspace/eslint.config.ts",
    ]);

  // Evaluate the workspace DAG before running parallel checks.
  // Without this sync, each parallel check submits the FULL workspace
  // construction DAG to the engine, which can exceed GraphQL query limits.
  await withTiming("workspace setup", () => preparedWorkspace.sync());

  // Build desktop frontend once and share
  const desktopFrontend = buildDesktopFrontend(pkgSource);

  // Debug: check file state in container before running checks
  const debugContainer = preparedWorkspace.withWorkdir("/workspace");
  const debugOutput = await execOrThrow(debugContainer, [
    "sh", "-c",
    "echo '=== env.d.ts ===' && cat packages/frontend/src/env.d.ts && echo '=== astro in node_modules ===' && ls -la node_modules/astro/client.d.ts 2>&1 || echo 'astro not found' && echo '=== vite in node_modules ===' && ls -la node_modules/vite/client.d.ts 2>&1 || echo 'vite not found' && echo '=== frontend node_modules ===' && ls packages/frontend/node_modules/ 2>&1 || echo 'no frontend node_modules' && echo '=== data package resolution ===' && ls node_modules/@scout-for-lol/data/src/review/prompts/personalities/aaron.txt 2>&1 || echo 'data file not found'",
  ]);
  logWithTimestamp(`Debug output:\n${debugOutput}`);

  // Run all checks in parallel using execOrThrow to capture actual error output
  // (avoids opaque "GraphQL error" messages from Dagger on non-zero exit codes)
  const workspace = preparedWorkspace.withWorkdir("/workspace");
  await withTiming("all checks", async () => {
    await Promise.all([
      withTiming("typecheck all", () =>
        execOrThrow(workspace, ["bun", "run", "typecheck"]),
      ),
      withTiming("lint all", () =>
        execOrThrow(workspace, [
          "bunx",
          "eslint",
          "packages/",
          "--cache",
          "--cache-strategy",
          "content",
          "--cache-location",
          "/workspace/.eslintcache",
        ]),
      ),
      withTiming("test all", () =>
        execOrThrow(workspace, ["bun", "run", "test"]),
      ),
      withTiming("duplication check", () =>
        execOrThrow(workspace, ["bun", "run", "duplication-check"]),
      ),
      withTiming("desktop check (parallel TS + Rust)", async () => {
        await checkDesktopParallel(pkgSource, desktopFrontend, eslintConfigSource, tsconfigBase);
      }),
    ]);
  });

  logWithTimestamp("All checks completed successfully for scout-for-lol");
  return "All checks completed successfully";
}

/**
 * Deploy scout-for-lol: backend GHCR + homelab, S3 frontend, GitHub Releases desktop.
 * Extracts the scout-for-lol package from the monorepo source and uses the
 * nested workspace's own bun.lock for dependency resolution.
 */
type DeployScoutForLolOptions = {
  source: Directory;
  version: string;
  gitSha: string;
  ghcrUsername: string;
  ghcrPassword: Secret;
  ghToken: Secret;
  s3AccessKeyId: Secret;
  s3SecretAccessKey: Secret;
};

export async function deployScoutForLol(
  options: DeployScoutForLolOptions,
): Promise<string> {
  const { source, version, gitSha, ghcrUsername, ghcrPassword, ghToken, s3AccessKeyId, s3SecretAccessKey } = options;
  const pkgSource = source.directory("packages/scout-for-lol");
  const outputs: string[] = [];

  logWithTimestamp(
    `Starting deploy for scout-for-lol version ${version} (${gitSha})`,
  );

  // Generate Prisma client once
  const prismaGenerated = generatePrismaClient(pkgSource);
  const preparedWorkspace = getPreparedWorkspace(pkgSource, prismaGenerated);

  // Build desktop frontend once and share across desktop operations
  const desktopFrontend = buildDesktopFrontend(pkgSource);

  // Build backend image and desktop Windows build in parallel
  const backendImagePromise = withTiming(
    "backend Docker image build",
    async () => {
      const image = buildBackendImage(
        pkgSource,
        version,
        gitSha,
        preparedWorkspace,
      );
      await image.id();
      return image;
    },
  );

  const desktopBuildWindowsPromise = withTiming(
    "desktop application build (Windows)",
    async () => {
      const container = buildDesktopWindowsGnu(
        pkgSource,
        version,
        desktopFrontend,
      );
      await container.sync();
      return container;
    },
  );

  const [backendImage, desktopWindowsContainer] = await Promise.all([
    backendImagePromise,
    desktopBuildWindowsPromise,
  ]);

  // Smoke test the backend image
  await withTiming("backend image smoke test", async () => {
    const smokeTestResult = await smokeTestBackendImageWithContainer(
      backendImage,
      pkgSource,
    );
    logWithTimestamp(`Smoke test result: ${smokeTestResult}`);
    if (smokeTestResult.includes("Smoke test failed")) {
      throw new Error(`Backend image smoke test failed: ${smokeTestResult}`);
    }
  });
  outputs.push("Backend image smoke test passed");

  // Publish backend image to GHCR
  await withTiming("backend GHCR publish", async () => {
    const backendImageName = "ghcr.io/shepherdjerred/scout-for-lol";
    await publishToGhcrMultiple({
      container: backendImage,
      imageRefs: [
        `${backendImageName}:${version}`,
        `${backendImageName}:${gitSha}`,
      ],
      username: ghcrUsername,
      password: ghcrPassword,
    });
  });
  outputs.push("Backend published to GHCR");

  // Deploy frontend to S3
  await withTiming("frontend S3 deploy", async () => {
    const frontendDist = buildFrontend(pkgSource);
    const syncOutput = await syncToS3({
      sourceDir: frontendDist,
      bucketName: "scout-frontend",
      endpointUrl: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      region: "us-east-1",
      deleteRemoved: true,
    });
    logWithTimestamp(`Frontend deployed to S3: ${syncOutput}`);
  });
  outputs.push("Frontend deployed to S3");

  // Publish desktop artifacts to GitHub Releases (Windows only)
  await withTiming("desktop GitHub Releases publish", async () => {
    await publishDesktopArtifactsWindowsOnly({
      windowsContainer: desktopWindowsContainer,
      version,
      gitSha,
      ghToken,
    });
  });
  outputs.push("Desktop artifacts published to GitHub Releases");

  logWithTimestamp("Deploy completed successfully for scout-for-lol");
  return outputs.join("\n");
}
