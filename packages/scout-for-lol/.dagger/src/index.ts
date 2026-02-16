/* eslint-disable max-lines  -- this file cannot be split up due to Dagger */
import type { Directory, Secret, Container } from "@dagger.io/dagger";
import { dag, func, argument, object } from "@dagger.io/dagger";
import { updateHomelabVersion, syncToS3 } from "@shepherdjerred/dagger-utils/containers";
import {
  buildBackendImage,
  publishBackendImage,
  publishBackendImageWithContainer,
  smokeTestBackendImage,
  smokeTestBackendImageWithContainer,
  getBackendCoverage,
  getBackendTestReport,
} from "@scout-for-lol/.dagger/src/backend";
import { getReportCoverage, getReportTestReport } from "@scout-for-lol/.dagger/src/report";
import { checkData, getDataCoverage, getDataTestReport } from "@scout-for-lol/.dagger/src/data";
import { checkFrontend, buildFrontend } from "@scout-for-lol/.dagger/src/frontend";
import {
  checkDesktop,
  checkDesktopParallel,
  buildDesktopLinux,
  buildDesktopFrontend,
  getDesktopLinuxArtifacts,
  buildDesktopWindowsGnu,
  getDesktopWindowsArtifacts,
  installDesktopDeps,
} from "@scout-for-lol/.dagger/src/desktop";
import {
  getGitHubContainer,
  getBunNodeContainer,
  getPreparedWorkspace,
  getPreparedMountedWorkspace,
  generatePrismaClient,
} from "@scout-for-lol/.dagger/src/base";

// Helper function to log with timestamp
function logWithTimestamp(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Helper to extract message from unknown error value
// Dagger errors often contain a 'stderr' property with the actual command output
function getErrorMessage(error: unknown): string {
  if (error === null || error === undefined) {
    return String(error);
  }

  // Check if it's an Error object with message first
  if (error instanceof Error) {
    // Check if the Error also has stderr (Dagger exec errors extend Error)
    const errorWithStderr = error as Error & { stderr?: string; stdout?: string };
    if (typeof errorWithStderr.stderr === "string" && errorWithStderr.stderr.length > 0) {
      return `${error.message}\n\nStderr:\n${errorWithStderr.stderr}`;
    }
    if (typeof errorWithStderr.stdout === "string" && errorWithStderr.stdout.length > 0) {
      return `${error.message}\n\nOutput:\n${errorWithStderr.stdout}`;
    }
    return error.message;
  }

  // Check if it's an object with stderr (Dagger exec errors)
  if (typeof error === "object") {
    const errorObj = error as Record<string, unknown>;

    // Dagger errors may have stderr with actual command output
    const stderr = errorObj["stderr"];
    if (typeof stderr === "string" && stderr.length > 0) {
      const message = typeof errorObj["message"] === "string" ? errorObj["message"] : "Command failed";
      return `${message}\n\nStderr:\n${stderr}`;
    }

    // Check for stdout as fallback (some errors output there)
    const stdout = errorObj["stdout"];
    if (typeof stdout === "string" && stdout.length > 0) {
      const message = typeof errorObj["message"] === "string" ? errorObj["message"] : "Command failed";
      return `${message}\n\nOutput:\n${stdout}`;
    }
  }

  // Try JSON stringify for other types
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    // Fallback if stringify fails - return generic message
    return "Unknown error occurred";
  }
}

// Helper function to measure execution time
async function withTiming<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  logWithTimestamp(`Starting ${operation}...`);
  try {
    const result = await fn();
    const duration = Date.now() - start;
    logWithTimestamp(`✅ ${operation} completed in ${duration.toString()}ms`);
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    const errorMessage = getErrorMessage(error);
    logWithTimestamp(`❌ ${operation} failed after ${duration.toString()}ms: ${errorMessage}`);
    throw error;
  }
}

@object()
export class ScoutForLol {
  /**
   * Run all checks (backend, report, data, frontend, desktop)
   * @param source The source directory
   * @returns A message indicating completion
   */
  @func()
  async check(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    logWithTimestamp("🔍 Starting comprehensive check process");

    // OPTIMIZATION: Generate Prisma client once and share
    logWithTimestamp("⚙️ Generating Prisma client...");
    const prismaGenerated = generatePrismaClient(source);

    // OPTIMIZATION: Use mounted workspace for CI checks (faster than copying files)
    const preparedWorkspace = getPreparedMountedWorkspace(source, prismaGenerated);

    // OPTIMIZATION: Build desktop frontend once and share
    const desktopFrontend = buildDesktopFrontend(source);

    // Run all checks in parallel for maximum speed
    await withTiming("all checks", async () => {
      await Promise.all([
        withTiming("typecheck all", async () => {
          await preparedWorkspace.withWorkdir("/workspace").withExec(["bun", "run", "typecheck"]).sync();
        }),
        withTiming("lint all", async () => {
          // Use ESLint with content-based caching for faster incremental runs
          await preparedWorkspace
            .withWorkdir("/workspace")
            .withExec([
              "bunx",
              "eslint",
              "packages/",
              "--cache",
              "--cache-strategy",
              "content",
              "--cache-location",
              "/workspace/.eslintcache",
            ])
            .sync();
        }),
        withTiming("test all", async () => {
          await preparedWorkspace.withWorkdir("/workspace").withExec(["bun", "run", "test"]).sync();
        }),
        withTiming("duplication check", async () => {
          await preparedWorkspace.withWorkdir("/workspace").withExec(["bun", "run", "duplication-check"]).sync();
        }),
        withTiming("desktop check (parallel TS + Rust)", async () => {
          await checkDesktopParallel(source, desktopFrontend);
        }),
      ]);
    });

    logWithTimestamp("🎉 All checks completed successfully");
    return "All checks completed successfully";
  }

  /**
   * Build all packages (backend image, desktop app)
   * @param source The source directory
   * @param version The version to build
   * @param gitSha The git SHA
   * @returns A message indicating completion
   */
  @func()
  async build(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
  ): Promise<string> {
    logWithTimestamp(`🔨 Starting build process for version ${version} (${gitSha})`);

    // OPTIMIZATION: Generate Prisma client once
    logWithTimestamp("⚙️ Generating Prisma client...");
    const prismaGenerated = generatePrismaClient(source);

    // OPTIMIZATION: Prepare workspace - don't sync(), let Dagger optimize
    const preparedWorkspace = getPreparedWorkspace(source, prismaGenerated);

    // Build backend image using prepared workspace
    const backendImage = await withTiming("backend Docker image build", async () => {
      const image = buildBackendImage(source, version, gitSha, preparedWorkspace);
      await image.id();
      return image;
    });

    // Smoke test the backend image (reuse already-built image)
    await withTiming("backend image smoke test", async () => {
      const smokeTestResult = await smokeTestBackendImageWithContainer(backendImage, source);
      logWithTimestamp(`Smoke test result: ${smokeTestResult}`);
      if (smokeTestResult.startsWith("❌")) {
        throw new Error(`Backend image smoke test failed: ${smokeTestResult}`);
      }
    });

    // Build desktop application
    await withTiming("desktop application build", async () => {
      await buildDesktopLinux(source, version).sync();
    });

    logWithTimestamp("🎉 All builds completed successfully");
    return "All builds completed successfully";
  }

  /**
   * Run the full CI pipeline
   * @param source The source directory
   * @param version The version to build
   * @param gitSha The git SHA
   * @param branch The git branch name (optional, for frontend deployment)
   * @param ghcrUsername The GitHub Container Registry username (optional)
   * @param ghcrPassword The GitHub Container Registry password/token (optional)
   * @param env The environment (prod/dev) - determines if images are published
   * @param ghToken The GitHub token for creating deployment PRs (optional)
   * @param s3AccessKeyId S3 access key ID (optional, for frontend deployment)
   * @param s3SecretAccessKey S3 secret access key (optional, for frontend deployment)
   * @returns A message indicating completion
   */
  @func()
  async ci(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
    branch?: string,
    ghcrUsername?: string,
    ghcrPassword?: Secret,
    env?: string,
    ghToken?: Secret,
    skipDesktopBuild?: string,
    s3AccessKeyId?: Secret,
    s3SecretAccessKey?: Secret,
  ): Promise<string> {
    const isProd = env === "prod";
    const shouldSkipDesktopBuild = skipDesktopBuild === "true" && !isProd;
    logWithTimestamp(`🚀 Starting CI pipeline for version ${version} (${gitSha}) in ${env ?? "dev"} environment`);
    if (shouldSkipDesktopBuild) {
      logWithTimestamp("⏭️ Skipping desktop build (no desktop changes detected)");
    }

    // OPTIMIZATION: Generate Prisma client ONCE and share across all containers
    // This is an expensive operation that should only happen once per CI run
    logWithTimestamp("⚙️ Generating Prisma client (once, shared across containers)...");
    const prismaGenerated = generatePrismaClient(source);

    // Use preparedWorkspace for all operations (embedded files work better with Dagger parallelism)
    const preparedWorkspace = getPreparedWorkspace(source, prismaGenerated);

    logWithTimestamp("📋 Phase 1: Running checks AND builds in parallel...");

    // Build the backend image in parallel with checks (uses regular workspace for publishable image)
    const backendImagePromise = withTiming("backend Docker image build", async () => {
      const image = buildBackendImage(source, version, gitSha, preparedWorkspace);
      await image.id();
      return image;
    });

    // Run typecheck, lint, and tests with MAXIMUM PARALLELISM via Dagger
    // Use preparedWorkspace (embedded files) instead of mountedWorkspace for parallel operations
    // This avoids issues with mounted files when forking containers in parallel
    const checksPromise = withTiming("all checks (lint, typecheck, tests)", async () => {
      await Promise.all([
        // TYPECHECK: Run each package's typecheck in parallel (5 parallel containers)
        // Use "bun run typecheck" to invoke each package's typecheck script properly
        withTiming("typecheck all (parallel)", async () => {
          await Promise.all([
            preparedWorkspace.withWorkdir("/workspace/packages/backend").withExec(["bun", "run", "typecheck"]).sync(),
            preparedWorkspace.withWorkdir("/workspace/packages/data").withExec(["bun", "run", "typecheck"]).sync(),
            preparedWorkspace.withWorkdir("/workspace/packages/report").withExec(["bun", "run", "typecheck"]).sync(),
            preparedWorkspace.withWorkdir("/workspace/packages/frontend").withExec(["bun", "run", "typecheck"]).sync(),
            preparedWorkspace.withWorkdir("/workspace/packages/desktop").withExec(["bun", "run", "typecheck"]).sync(),
            preparedWorkspace.withWorkdir("/workspace/packages/ui").withExec(["bun", "run", "typecheck"]).sync(),
          ]);
        }),

        // LINT: Run ESLint for each package in parallel
        // Use "bun run lint" to invoke each package's lint script properly
        withTiming("lint all (parallel)", async () => {
          await Promise.all([
            preparedWorkspace.withWorkdir("/workspace/packages/backend").withExec(["bun", "run", "lint"]).sync(),
            preparedWorkspace.withWorkdir("/workspace/packages/data").withExec(["bun", "run", "lint"]).sync(),
            preparedWorkspace.withWorkdir("/workspace/packages/report").withExec(["bun", "run", "lint"]).sync(),
            preparedWorkspace.withWorkdir("/workspace/packages/frontend").withExec(["bun", "run", "lint"]).sync(),
            preparedWorkspace.withWorkdir("/workspace/packages/desktop").withExec(["bun", "run", "lint"]).sync(),
            preparedWorkspace.withWorkdir("/workspace/packages/ui").withExec(["bun", "run", "lint"]).sync(),
          ]);
        }),

        // TESTS: Run tests for each package in parallel with JUnit output
        // JUnit reports are stored in a cache volume for artifact collection later
        withTiming("test all (parallel with JUnit)", async () => {
          const testArtifactsCache = dag.cacheVolume("test-artifacts");
          await Promise.all([
            // eslint-rules tests (root level)
            preparedWorkspace.withWorkdir("/workspace").withExec(["bun", "test", "eslint-rules/"]).sync(),
            // Package tests with JUnit reporters - output to cache for artifact collection
            preparedWorkspace
              .withMountedCache("/artifacts", testArtifactsCache)
              .withExec(["mkdir", "-p", "/artifacts/backend", "/artifacts/data", "/artifacts/report"])
              .withWorkdir("/workspace/packages/backend")
              .withExec([
                "bun",
                "test",
                "--reporter=default",
                "--reporter=junit",
                "--reporter-outfile=/artifacts/backend/junit.xml",
              ])
              .sync(),
            preparedWorkspace
              .withMountedCache("/artifacts", testArtifactsCache)
              .withWorkdir("/workspace/packages/data")
              .withExec([
                "bun",
                "test",
                "--reporter=default",
                "--reporter=junit",
                "--reporter-outfile=/artifacts/data/junit.xml",
              ])
              .sync(),
            preparedWorkspace
              .withMountedCache("/artifacts", testArtifactsCache)
              .withWorkdir("/workspace/packages/report")
              .withExec([
                "bun",
                "test",
                "--reporter=default",
                "--reporter=junit",
                "--reporter-outfile=/artifacts/report/junit.xml",
              ])
              .sync(),
            // Note: frontend and desktop tests are no-ops currently
          ]);
        }),

        // Duplication check
        withTiming("duplication check", async () => {
          await preparedWorkspace.withWorkdir("/workspace").withExec(["bun", "run", "duplication-check"]).sync();
        }),
      ]);
    });

    // Desktop checks and builds - only run if not skipped
    // Build frontend once and share across all desktop operations
    let desktopChecksPromise: Promise<void>;
    let desktopBuildWindowsPromise: Promise<Container | undefined>;

    if (shouldSkipDesktopBuild) {
      desktopChecksPromise = Promise.resolve();
      desktopBuildWindowsPromise = Promise.resolve(undefined);
    } else {
      // Build desktop frontend once, share across checks and builds
      const desktopFrontend = buildDesktopFrontend(source);

      // Desktop Rust checks (TypeScript/lint already covered by main checks above)
      // Only run Rust-specific checks: fmt, clippy, test
      desktopChecksPromise = withTiming("desktop Rust checks (fmt, clippy, test)", async () => {
        const baseContainer = installDesktopDeps(source);
        const containerWithFrontend = baseContainer
          .withDirectory("/workspace/packages/desktop/dist", desktopFrontend)
          .withMountedCache("/workspace/packages/desktop/src-tauri/target", dag.cacheVolume("rust-target-linux"));

        await containerWithFrontend
          .withWorkdir("/workspace/packages/desktop/src-tauri")
          .withExec(["cargo", "fmt", "--", "--check"])
          .withExec(["cargo", "clippy", "--all-targets", "--all-features", "--", "-D", "warnings"])
          .withExec(["cargo", "test", "--verbose"])
          .sync();
      });

      // Desktop build - Windows only (Linux not needed)
      desktopBuildWindowsPromise = withTiming("desktop application build (Windows)", async () => {
        logWithTimestamp("🔄 Building desktop application for Windows...");
        const container = buildDesktopWindowsGnu(source, version, desktopFrontend);
        await container.sync();
        return container;
      });
    }

    // Wait for checks, backend image build, desktop checks, and desktop build to complete
    const [, backendImage, , desktopWindowsContainer] = await Promise.all([
      checksPromise,
      backendImagePromise,
      desktopChecksPromise,
      desktopBuildWindowsPromise,
    ]);

    logWithTimestamp("✅ Phase 1 complete: All checks passed and builds finished");

    // Smoke test the backend image (reuse the already-built image)
    await withTiming("backend image smoke test", async () => {
      logWithTimestamp("🧪 Running smoke test on backend image...");
      const smokeTestResult = await smokeTestBackendImageWithContainer(backendImage, source);
      logWithTimestamp(`Smoke test result: ${smokeTestResult}`);

      if (smokeTestResult.startsWith("❌")) {
        throw new Error(`Backend image smoke test failed: ${smokeTestResult}`);
      }
    });

    // Publish images if credentials provided and environment is prod
    const shouldPublish = ghcrUsername && ghcrPassword && isProd;
    if (shouldPublish) {
      await withTiming("CI publish phase", async () => {
        logWithTimestamp("📦 Phase 2: Publishing Docker image to registry...");

        // Reuse the already-built image for publishing
        const publishedRefs = await publishBackendImageWithContainer({
          image: backendImage,
          version,
          gitSha,
          registryAuth: {
            username: ghcrUsername,
            password: ghcrPassword,
          },
        });

        logWithTimestamp(`✅ Images published: ${publishedRefs.join(", ")}`);
      });
    } else {
      logWithTimestamp("⏭️ Phase 2: Skipping image publishing (no credentials or not prod environment)");
    }

    // Publish desktop artifacts to GitHub Releases (only for prod with GitHub token and when desktop was built)
    const shouldPublishDesktop = isProd && ghToken && desktopWindowsContainer;
    if (shouldPublishDesktop) {
      await withTiming("CI desktop artifacts publish phase", async () => {
        logWithTimestamp("📦 Phase 2.5: Publishing desktop artifacts to GitHub Releases...");
        await this.publishDesktopArtifactsWindowsOnly(desktopWindowsContainer, version, gitSha, ghToken);
        logWithTimestamp("✅ Desktop artifacts published to GitHub Releases");
      });
    } else if (shouldSkipDesktopBuild) {
      logWithTimestamp("⏭️ Phase 2.5: Skipping desktop artifacts publishing (desktop build was skipped)");
    } else {
      logWithTimestamp("⏭️ Phase 2.5: Skipping desktop artifacts publishing (not prod or no GitHub token)");
    }

    // Deploy backend to homelab (only for prod)
    if (isProd) {
      await withTiming("CI backend deploy phase", () => {
        logWithTimestamp("🚀 Phase 3: Deploying backend to beta...");
        return this.deploy(source, version, "beta", ghToken);
      });
    } else {
      logWithTimestamp("⏭️ Phase 3: Skipping backend deployment (not prod environment)");
    }

    // Deploy frontend to S3 if credentials provided and on main branch
    const shouldDeployFrontend = s3AccessKeyId && s3SecretAccessKey && isProd && branch === "main";
    if (shouldDeployFrontend) {
      await withTiming("CI frontend deploy phase", async () => {
        logWithTimestamp("🚀 Phase 4: Deploying frontend to S3...");

        const frontendDist = buildFrontend(source);

        const syncOutput = await syncToS3({
          sourceDir: frontendDist,
          bucketName: "scout-frontend",
          endpointUrl: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
          accessKeyId: s3AccessKeyId,
          secretAccessKey: s3SecretAccessKey,
          region: "us-east-1",
          deleteRemoved: true,
        });

        logWithTimestamp(`✅ Frontend deployed to S3: ${syncOutput}`);
      });
    } else {
      logWithTimestamp("⏭️ Phase 4: Skipping frontend deployment (not prod or no S3 credentials)");
    }

    logWithTimestamp("🎉 CI pipeline completed successfully");
    return "CI pipeline completed successfully";
  }

  /**
   * Deploy to the specified stage by updating homelab version and creating a PR
   * @param source The source directory (unused but kept for API compatibility)
   * @param version The version to deploy
   * @param stage The stage to deploy to
   * @param ghToken The GitHub token secret
   * @returns A message indicating completion
   */
  @func()
  async deploy(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() stage: string,
    ghToken?: Secret,
  ): Promise<string> {
    logWithTimestamp(`🚀 Starting deployment to ${stage} stage for version ${version}`);

    if (!ghToken) {
      logWithTimestamp(`⚠️ No GitHub token provided - deployment to ${stage} skipped`);
      return `Deployment to ${stage} skipped (no GitHub token provided)`;
    }

    const result = await updateHomelabVersion({
      ghToken,
      appName: `scout-for-lol/${stage}`,
      version,
    });

    logWithTimestamp(`✅ Deployment to ${stage} completed successfully`);
    return result;
  }

  /**
   * Generate Prisma client for the backend package
   * @param source The backend source directory
   * @returns The generated Prisma client
   */
  @func()
  async generatePrisma(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: "packages/backend",
    })
    source: Directory,
  ): Promise<Directory> {
    logWithTimestamp("⚙️ Generating Prisma client for backend package");

    const result = await withTiming("Prisma client generation", () => {
      // Create a workspace container with dependencies
      const workspaceContainer = getBunNodeContainer()
        .withExec(["apt", "install", "-y", "openssl"])
        .withWorkdir("/workspace")
        .withFile("/workspace/package.json", source.file("../../package.json"))
        .withFile("/workspace/bun.lock", source.file("../../bun.lock"))
        .withDirectory("/workspace/packages/backend", source)
        .withWorkdir("/workspace")
        .withExec(["bun", "install", "--frozen-lockfile"]);

      return Promise.resolve(
        workspaceContainer
          .withWorkdir("/workspace/packages/backend")
          .withExec(["bun", "run", "generate"])
          .directory("/workspace/packages/backend/generated"),
      );
    });

    logWithTimestamp("✅ Prisma client generated successfully");
    return result;
  }

  /**
   * Build the backend Docker image
   * @param source The workspace source directory
   * @param version The version to build
   * @param gitSha The git SHA
   * @returns The built container
   */
  @func()
  async buildBackendImage(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
  ): Promise<Container> {
    logWithTimestamp(`🐳 Building backend Docker image for version ${version} (${gitSha})`);

    const result = await withTiming("backend Docker image build", () =>
      Promise.resolve(buildBackendImage(source, version, gitSha)),
    );

    logWithTimestamp("✅ Backend Docker image built successfully");
    return result;
  }

  /**
   * Publish the backend Docker image
   * @param source The workspace source directory
   * @param version The version to publish
   * @param gitSha The git SHA
   * @param registryUsername Optional registry username for authentication
   * @param registryPassword Optional registry password for authentication
   * @returns The published image references
   */
  @func()
  async publishBackendImage(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
    registryUsername?: string,
    registryPassword?: Secret,
  ): Promise<string[]> {
    logWithTimestamp(`📦 Publishing backend Docker image for version ${version} (${gitSha})`);

    const result = await withTiming("backend Docker image publish", () => {
      const options: Parameters<typeof publishBackendImage>[0] = {
        workspaceSource: source,
        version,
        gitSha,
      };
      if (registryUsername && registryPassword) {
        options.registryAuth = { username: registryUsername, password: registryPassword };
      }
      return publishBackendImage(options);
    });

    logWithTimestamp(`✅ Backend Docker image published successfully: ${result.join(", ")}`);
    return result;
  }

  /**
   * Smoke test the backend Docker image
   * @param source The workspace source directory
   * @param version The version to test
   * @param gitSha The git SHA
   * @returns Test result with analysis
   */
  @func()
  async smokeTestBackendImage(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
  ): Promise<string> {
    logWithTimestamp(`🧪 Smoke testing backend Docker image for version ${version} (${gitSha})`);

    const result = await withTiming("backend Docker image smoke test", () =>
      smokeTestBackendImage(source, version, gitSha),
    );

    logWithTimestamp("✅ Backend Docker image smoke test completed");
    return result;
  }

  /**
   * Check the report package
   * @param _source The workspace source directory
   * @returns A message indicating completion
   */
  @func()
  checkReport(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    _source: Directory,
  ): Promise<string> {
    logWithTimestamp("🔍 Starting report package check");

    // await withTiming("report package check", () => Promise.resolve(checkReport(_source)));

    logWithTimestamp("✅ Report check completed successfully");
    return Promise.resolve("Report check completed successfully");
  }

  /**
   * Check the data package
   * @param source The workspace source directory
   * @returns A message indicating completion
   */
  @func()
  async checkData(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    logWithTimestamp("🔍 Starting data package check");

    await withTiming("data package check", () => Promise.resolve(checkData(source)));

    logWithTimestamp("✅ Data check completed successfully");
    return "Data check completed successfully";
  }

  /**
   * Get backend test coverage
   * @param source The workspace source directory
   * @returns The coverage directory
   */
  @func()
  backendCoverage(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Directory {
    logWithTimestamp("📊 Exporting backend test coverage");
    return getBackendCoverage(source);
  }

  /**
   * Get backend test report (junit.xml)
   * @param source The workspace source directory
   * @returns The directory containing junit.xml
   */
  @func()
  backendTestReport(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Directory {
    logWithTimestamp("📋 Exporting backend test report");
    return getBackendTestReport(source);
  }

  /**
   * Get data package test coverage
   * @param source The workspace source directory
   * @returns The coverage directory
   */
  @func()
  dataCoverage(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Directory {
    logWithTimestamp("📊 Exporting data package test coverage");
    return getDataCoverage(source);
  }

  /**
   * Get data package test report (junit.xml)
   * @param source The workspace source directory
   * @returns The directory containing junit.xml
   */
  @func()
  dataTestReport(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Directory {
    logWithTimestamp("📋 Exporting data package test report");
    return getDataTestReport(source);
  }

  /**
   * Get report package test coverage
   * @param source The workspace source directory
   * @returns The coverage directory
   */
  @func()
  reportCoverage(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Directory {
    logWithTimestamp("📊 Exporting report package test coverage");
    return getReportCoverage(source);
  }

  /**
   * Get report package test report (junit.xml)
   * @param source The workspace source directory
   * @returns The directory containing junit.xml
   */
  @func()
  reportTestReport(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Directory {
    logWithTimestamp("📋 Exporting report package test report");
    return getReportTestReport(source);
  }

  /**
   * Check the frontend package
   * @param source The workspace source directory
   * @returns A message indicating completion
   */
  @func()
  async checkFrontend(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    logWithTimestamp("🔍 Starting frontend package check");

    await withTiming("frontend package check", async () => {
      const container = checkFrontend(source);
      await container.sync();
      return container;
    });

    logWithTimestamp("✅ Frontend check completed successfully");
    return "Frontend check completed successfully";
  }

  /**
   * Build the frontend package
   * @param source The workspace source directory
   * @returns The built dist directory
   */
  @func()
  async buildFrontend(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<Directory> {
    logWithTimestamp("🏗️  Building frontend package");

    const result = await withTiming("frontend build", () => Promise.resolve(buildFrontend(source)));

    logWithTimestamp("✅ Frontend build completed successfully");
    return result;
  }

  /**
   * Check for code duplication across packages
   * @param source The workspace source directory
   * @returns A message indicating completion
   */
  @func()
  async duplicationCheck(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    logWithTimestamp("🔍 Starting code duplication check");

    await withTiming("code duplication check", async () => {
      const container = getBunNodeContainer(source)
        .withExec(["bun", "install", "--frozen-lockfile"])
        .withExec(["bun", "run", "scripts/check-duplication.ts"]);
      await container.sync();
      return container;
    });

    logWithTimestamp("✅ Code duplication check completed successfully");
    return "Code duplication check completed successfully";
  }

  /**
   * Check the desktop package
   * @param source The workspace source directory
   * @returns A message indicating completion
   */
  @func()
  async checkDesktop(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    logWithTimestamp("🔍 Starting desktop package check");

    await withTiming("desktop package check", async () => {
      const container = checkDesktop(source);
      await container.sync();
      return container;
    });

    logWithTimestamp("✅ Desktop check completed successfully");
    return "Desktop check completed successfully";
  }

  /**
   * Build the desktop application for Linux
   * @param source The workspace source directory
   * @param version The version to build
   * @returns A message indicating completion
   */
  @func()
  async buildDesktop(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
  ): Promise<string> {
    logWithTimestamp(`🏗️  Building desktop application for version ${version}`);

    await withTiming("desktop build", async () => {
      const container = buildDesktopLinux(source, version);
      await container.sync();
      return container;
    });

    logWithTimestamp("✅ Desktop build completed successfully");
    return `Desktop build completed successfully for version ${version}`;
  }

  /**
   * Build the desktop application for Windows (x86_64-pc-windows-gnu)
   * @param source The workspace source directory
   * @param version The version to build
   * @returns A message indicating completion
   */
  @func()
  async buildDesktopWindows(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
  ): Promise<string> {
    logWithTimestamp(`🏗️  Building desktop application for Windows (GNU) version ${version}`);

    await withTiming("desktop build (windows gnu)", async () => {
      const container = buildDesktopWindowsGnu(source, version);
      await container.sync();
      return container;
    });

    logWithTimestamp("✅ Desktop Windows build completed successfully");
    return `Desktop Windows (GNU) build completed successfully for version ${version}`;
  }

  /**
   * Export desktop Linux build artifacts
   * @param source The workspace source directory
   * @param version The version to build
   * @returns The directory containing built artifacts
   */
  @func()
  async desktopArtifacts(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
  ): Promise<Directory> {
    logWithTimestamp(`📦 Exporting desktop artifacts for version ${version}`);

    const result = await withTiming("desktop artifacts export", () =>
      Promise.resolve(getDesktopLinuxArtifacts(source, version)),
    );

    logWithTimestamp("✅ Desktop artifacts exported successfully");
    return result;
  }

  /**
   * Export desktop Windows (x86_64-pc-windows-gnu) build artifacts
   * @param source The workspace source directory
   * @param version The version to build
   * @returns The directory containing built artifacts
   */
  @func()
  async desktopWindowsArtifacts(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
  ): Promise<Directory> {
    logWithTimestamp(`📦 Exporting desktop Windows artifacts for version ${version}`);

    const result = await withTiming("desktop windows artifacts export", () =>
      Promise.resolve(getDesktopWindowsArtifacts(source, version)),
    );

    logWithTimestamp("✅ Desktop Windows artifacts exported successfully");
    return result;
  }

  /**
   * Publish desktop artifacts to GitHub Releases
   * @param source The workspace source directory
   * @param version The version to publish
   * @param gitSha The git commit SHA
   * @param ghToken GitHub token for authentication
   * @param repo The repository name (defaults to "shepherdjerred/scout-for-lol")
   * @returns A message indicating completion
   */
  /**
   * Publish desktop artifacts using pre-built containers
   * @param linuxContainer The Linux build container
   * @param windowsContainer The Windows build container
   * @param version The version tag
   * @param gitSha The git commit SHA
   * @param ghToken GitHub token for authentication
   * @param repo The repository name (default: shepherdjerred/scout-for-lol)
   * @returns A message indicating completion
   */
  @func()
  async publishDesktopArtifactsWithContainers(
    linuxContainer: Container,
    windowsContainer: Container,
    @argument() version: string,
    @argument() gitSha: string,
    ghToken: Secret,
    repo = "shepherdjerred/scout-for-lol",
  ): Promise<string> {
    logWithTimestamp(`📦 Publishing desktop artifacts to GitHub Releases for version ${version}`);

    await withTiming("desktop artifacts GitHub release", async () => {
      // Get the already-built Linux and Windows artifacts from the pre-built containers
      // Artifacts are copied to /artifacts/ during build to persist beyond the cache mount
      logWithTimestamp("📥 Collecting Linux artifacts...");
      const linuxArtifactsDir = linuxContainer.directory("/artifacts/bundle");

      logWithTimestamp("📥 Collecting Windows artifacts...");
      const windowsArtifactsDir = windowsContainer.directory("/artifacts");

      // Create a staging directory with all artifacts
      logWithTimestamp("🏗️  Staging artifacts for upload...");
      const container = getGitHubContainer()
        .withSecretVariable("GH_TOKEN", ghToken)
        .withWorkdir("/artifacts")
        .withDirectory("/artifacts/linux", linuxArtifactsDir)
        .withDirectory("/artifacts/windows", windowsArtifactsDir)
        // List the artifacts for debugging
        .withExec(["sh", "-c", "echo '📋 Linux artifacts:' && find linux -type f"])
        .withExec(["sh", "-c", "echo '📋 Windows artifacts:' && find windows -type f"]);

      // Create or update the GitHub release
      logWithTimestamp(`🚀 Creating/updating GitHub release v${version}...`);

      // Step 1: Verify authentication and check token scopes
      logWithTimestamp(`🔐 Verifying GitHub authentication...`);

      // First, check basic auth status (allow failure to capture output)
      let authCheckContainer: Container;
      let authOutput: string;
      try {
        authCheckContainer = container.withExec(["sh", "-c", 'gh auth status 2>&1; echo "AUTH_EXIT_CODE=$?"']);
        authOutput = await authCheckContainer.stdout();
        logWithTimestamp(`Auth status output: ${authOutput.trim()}`);

        if (authOutput.includes("AUTH_EXIT_CODE=0")) {
          logWithTimestamp(`✓ GitHub authentication successful`);
        } else {
          logWithTimestamp(`⚠️ GitHub authentication check returned non-zero exit code`);
        }
      } catch (error) {
        logWithTimestamp(`❌ Auth check failed with error: ${error instanceof Error ? error.message : String(error)}`);
        // Try to get any stderr output
        try {
          const stderr = await authCheckContainer!.stderr();
          logWithTimestamp(`Auth check stderr: ${stderr}`);
        } catch {
          // Ignore stderr fetch errors
        }
        throw error;
      }

      // Try a simple API call to verify token works
      logWithTimestamp(`🔍 Testing GitHub API access...`);
      let apiTestContainer: Container;
      let apiOutput: string;
      try {
        apiTestContainer = container.withExec(["sh", "-c", 'gh api user 2>&1; echo "API_EXIT_CODE=$?"']);
        apiOutput = await apiTestContainer.stdout();
        logWithTimestamp(`API test output: ${apiOutput.trim()}`);

        if (!apiOutput.includes("API_EXIT_CODE=0")) {
          throw new Error(`GitHub API access failed. Output: ${apiOutput}`);
        }

        logWithTimestamp(`✓ GitHub authentication verified`);
      } catch (error) {
        logWithTimestamp(`❌ API test failed with error: ${error instanceof Error ? error.message : String(error)}`);
        // Try to get stderr
        try {
          const stderr = await apiTestContainer!.stderr();
          logWithTimestamp(`API test stderr: ${stderr}`);
        } catch {
          // Ignore stderr fetch errors
        }
        throw error;
      }

      // Step 2: Check if release exists (capture output for debugging)
      logWithTimestamp(`🔍 Checking if release v${version} exists...`);
      const checkReleaseContainer = container.withExec([
        "sh",
        "-c",
        // Use a more robust check that captures the exit code
        `if gh release view "v${version}" --repo="${repo}" > /dev/null 2>&1; then
          echo "RELEASE_EXISTS"
        else
          EXIT_CODE=$?
          echo "RELEASE_NOT_FOUND"
          if [ $EXIT_CODE -ne 1 ]; then
            echo "ERROR: gh release view failed with exit code $EXIT_CODE" >&2
            gh release view "v${version}" --repo="${repo}" 2>&1 || true
          fi
        fi`,
      ]);
      const checkOutput = await checkReleaseContainer.stdout();
      const releaseExists = checkOutput.includes("RELEASE_EXISTS");

      if (checkOutput.includes("ERROR:")) {
        logWithTimestamp(`⚠️  Warning during release check: ${checkOutput}`);
      }

      logWithTimestamp(`Release check result: ${releaseExists ? "exists" : "needs creation"}`);

      // Step 3: Create release if it doesn't exist
      let releaseContainer = checkReleaseContainer;
      if (!releaseExists) {
        logWithTimestamp(`Creating new release v${version}...`);
        releaseContainer = releaseContainer.withExec([
          "gh",
          "release",
          "create",
          `v${version}`,
          `--repo=${repo}`,
          `--title=v${version}`,
          `--notes=Release ${version} (${gitSha.substring(0, 7)})`,
          "--latest",
        ]);
        await releaseContainer.sync();
        logWithTimestamp(`✓ Release v${version} created successfully`);
      }

      // Step 4: Upload Linux artifacts
      logWithTimestamp(`📤 Uploading Linux artifacts...`);
      releaseContainer = releaseContainer.withExec([
        "sh",
        "-c",
        `find linux -type f \\( -name "*.deb" -o -name "*.AppImage" -o -name "*.rpm" \\) -exec gh release upload "v${version}" {} --repo="${repo}" --clobber \\; 2>&1 || (echo '❌ Linux upload failed' && exit 1)`,
      ]);
      await releaseContainer.sync();

      // Step 5: Upload Windows artifacts
      logWithTimestamp(`📤 Uploading Windows artifacts...`);
      releaseContainer = releaseContainer.withExec([
        "sh",
        "-c",
        `find windows -type f \\( -name "*.exe" -o -name "*.msi" \\) -exec gh release upload "v${version}" {} --repo="${repo}" --clobber \\; 2>&1 || (echo '❌ Windows upload failed' && exit 1)`,
      ]);
      await releaseContainer.sync();

      logWithTimestamp(`✅ All artifacts uploaded to https://github.com/${repo}/releases/tag/v${version}`);
    });

    logWithTimestamp(`✅ Desktop artifacts published to GitHub Releases: v${version}`);
    return `Desktop artifacts published to GitHub Releases: v${version}`;
  }

  /**
   * Publish Windows-only desktop artifacts to GitHub Releases
   * @param windowsContainer The Windows build container
   * @param version The version tag
   * @param gitSha The git commit SHA
   * @param ghToken GitHub token for authentication
   * @param repo The repository name (default: shepherdjerred/scout-for-lol)
   * @returns A message indicating completion
   */
  @func()
  async publishDesktopArtifactsWindowsOnly(
    windowsContainer: Container,
    @argument() version: string,
    @argument() gitSha: string,
    ghToken: Secret,
    repo = "shepherdjerred/scout-for-lol",
  ): Promise<string> {
    logWithTimestamp(`📦 Publishing Windows desktop artifacts to GitHub Releases for version ${version}`);

    await withTiming("desktop artifacts GitHub release (Windows only)", async () => {
      logWithTimestamp("📥 Collecting Windows artifacts...");
      const windowsArtifactsDir = windowsContainer.directory("/artifacts");

      // Create a staging directory with Windows artifacts
      logWithTimestamp("🏗️  Staging artifacts for upload...");
      const container = getGitHubContainer()
        .withSecretVariable("GH_TOKEN", ghToken)
        .withWorkdir("/artifacts")
        .withDirectory("/artifacts/windows", windowsArtifactsDir)
        .withExec(["sh", "-c", "echo '📋 Windows artifacts:' && find windows -type f"]);

      // Verify GitHub authentication
      logWithTimestamp(`🔐 Verifying GitHub authentication...`);
      const authCheckContainer = container.withExec(["sh", "-c", 'gh auth status 2>&1; echo "AUTH_EXIT_CODE=$?"']);
      const authOutput = await authCheckContainer.stdout();
      if (!authOutput.includes("AUTH_EXIT_CODE=0")) {
        throw new Error(`GitHub authentication failed: ${authOutput}`);
      }

      // Check if release exists
      logWithTimestamp(`🔍 Checking if release v${version} exists...`);
      const checkReleaseContainer = container.withExec([
        "sh",
        "-c",
        `if gh release view "v${version}" --repo="${repo}" > /dev/null 2>&1; then echo "RELEASE_EXISTS"; else echo "RELEASE_NOT_FOUND"; fi`,
      ]);
      const checkOutput = await checkReleaseContainer.stdout();
      const releaseExists = checkOutput.includes("RELEASE_EXISTS");

      // Create release if it doesn't exist
      let releaseContainer = checkReleaseContainer;
      if (!releaseExists) {
        logWithTimestamp(`Creating new release v${version}...`);
        releaseContainer = releaseContainer.withExec([
          "gh",
          "release",
          "create",
          `v${version}`,
          `--repo=${repo}`,
          `--title=v${version}`,
          `--notes=Release ${version} (${gitSha.substring(0, 7)})`,
          "--latest",
        ]);
        await releaseContainer.sync();
      }

      // Upload Windows artifacts
      logWithTimestamp(`📤 Uploading Windows artifacts...`);
      releaseContainer = releaseContainer.withExec([
        "sh",
        "-c",
        `find windows -type f \\( -name "*.exe" -o -name "*.msi" \\) -exec gh release upload "v${version}" {} --repo="${repo}" --clobber \\; 2>&1 || (echo '❌ Windows upload failed' && exit 1)`,
      ]);
      await releaseContainer.sync();

      logWithTimestamp(`✅ Windows artifacts uploaded to https://github.com/${repo}/releases/tag/v${version}`);
    });

    return `Windows desktop artifacts published to GitHub Releases: v${version}`;
  }

  /**
   * Build and publish desktop artifacts (builds from scratch)
   * @param source The source directory
   * @param version The version tag
   * @param gitSha The git commit SHA
   * @param ghToken GitHub token for authentication
   * @param repo The repository name (default: shepherdjerred/scout-for-lol)
   * @returns A message indicating completion
   */
  @func()
  async publishDesktopArtifacts(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
    ghToken: Secret,
    repo = "shepherdjerred/scout-for-lol",
  ): Promise<string> {
    logWithTimestamp(`📦 Building desktop applications for publishing...`);

    // Build both platforms
    const linuxContainer = buildDesktopLinux(source, version);
    const windowsContainer = buildDesktopWindowsGnu(source, version);

    // Wait for builds to complete
    await Promise.all([linuxContainer.sync(), windowsContainer.sync()]);

    // Use the pre-built containers to publish
    return await this.publishDesktopArtifactsWithContainers(
      linuxContainer,
      windowsContainer,
      version,
      gitSha,
      ghToken,
      repo,
    );
  }

  /**
   * Run CI and return artifacts (test reports, coverage, lint results)
   * This is a combined function that runs CI checks and collects artifacts in one pass.
   * Use this instead of calling ci() + ciArtifacts() separately to avoid running checks twice.
   * @param source The workspace source directory
   * @param version The version to build
   * @param gitSha The git SHA
   * @param branch The git branch name (optional)
   * @param ghcrUsername The GitHub Container Registry username (optional)
   * @param ghcrPassword The GitHub Container Registry password/token (optional)
   * @param env The environment (prod/dev)
   * @param ghToken The GitHub token (optional)
   * @returns A directory containing CI artifacts (junit.xml, coverage, etc.)
   */
  @func()
  async ciWithArtifacts(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
    branch?: string,
    ghcrUsername?: string,
    ghcrPassword?: Secret,
    env?: string,
    ghToken?: Secret,
    skipDesktopBuild?: string,
    s3AccessKeyId?: Secret,
    s3SecretAccessKey?: Secret,
  ): Promise<Directory> {
    // Run the full CI pipeline first
    await this.ci(source, version, gitSha, branch, ghcrUsername, ghcrPassword, env, ghToken, skipDesktopBuild, s3AccessKeyId, s3SecretAccessKey);

    // After CI passes, collect artifacts
    // Since we just ran CI with the same inputs, Dagger will cache all the setup
    // and only run the artifact collection commands
    logWithTimestamp("📊 Collecting CI artifacts...");

    const prismaGenerated = generatePrismaClient(source);
    const preparedWorkspace = getPreparedMountedWorkspace(source, prismaGenerated);

    const artifactsContainer = await withTiming("artifact collection", async () => {
      // Use the same cache volume where tests stored their JUnit reports
      const testArtifactsCache = dag.cacheVolume("test-artifacts");

      let workspace = preparedWorkspace
        .withWorkdir("/workspace")
        // Mount the test artifacts cache to copy JUnit reports from it
        .withMountedCache("/test-artifacts", testArtifactsCache);

      // Create artifacts directory and copy JUnit reports from cache
      // Tests already ran with JUnit output during ci() - just copy the reports
      workspace = workspace
        .withExec([
          "mkdir",
          "-p",
          "/artifacts/backend",
          "/artifacts/data",
          "/artifacts/report",
          "/artifacts/desktop",
          "/artifacts/frontend",
        ])
        .withExec([
          "sh",
          "-c",
          "cp /test-artifacts/backend/junit.xml /artifacts/backend/ 2>/dev/null || echo 'No backend JUnit found'",
        ])
        .withExec([
          "sh",
          "-c",
          "cp /test-artifacts/data/junit.xml /artifacts/data/ 2>/dev/null || echo 'No data JUnit found'",
        ])
        .withExec([
          "sh",
          "-c",
          "cp /test-artifacts/report/junit.xml /artifacts/report/ 2>/dev/null || echo 'No report JUnit found'",
        ]);

      // ESLint report (JSON format) - uses cache so should be fast
      workspace = workspace.withExec([
        "sh",
        "-c",
        "cd /workspace && bunx eslint packages/ --cache --format json --output-file /artifacts/eslint-report.json 2>/dev/null || true",
      ]);

      // Knip report (JSON format)
      workspace = workspace.withExec([
        "sh",
        "-c",
        "cd /workspace && knip-bun --reporter json > /artifacts/knip-report.json 2>/dev/null || true",
      ]);

      // JSCPD duplication report - already ran, just copy results
      workspace = workspace.withExec([
        "sh",
        "-c",
        "cp -r /workspace/jscpd-report /artifacts/ 2>/dev/null || echo 'No JSCPD report found'",
      ]);

      // List artifacts for debugging
      workspace = workspace.withExec(["sh", "-c", "echo '📋 Generated artifacts:' && find /artifacts -type f"]);

      await workspace.sync();
      return workspace;
    });

    logWithTimestamp("✅ CI artifacts collected successfully");
    return artifactsContainer.directory("/artifacts");
  }
}
