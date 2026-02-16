import {
  func,
  argument,
  Directory,
  object,
  Secret,
  Container,
} from "@dagger.io/dagger";
import {
  checkBackend,
  buildBackendImage,
  publishBackendImage,
  smokeTestBackendImage,
} from "./backend";
import { checkReport, buildReportForNpm, publishReportToNpm } from "./report";
import { getDataSource, checkData } from "./data";
import { getGitHubContainer, getBunNodeContainer } from "./base";

// Helper function to log with timestamp
function logWithTimestamp(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Helper function to measure execution time
async function withTiming<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  logWithTimestamp(`Starting ${operation}...`);
  try {
    const result = await fn();
    const duration = Date.now() - start;
    logWithTimestamp(`✅ ${operation} completed in ${duration.toString()}ms`);
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    logWithTimestamp(
      `❌ ${operation} failed after ${duration.toString()}ms: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

@object()
export class ScoutForLol {
  /**
   * Run all checks (backend, report, data)
   * @param source The source directory
   * @returns A message indicating completion
   */
  @func()
  async check(
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: ".",
    })
    source: Directory
  ): Promise<string> {
    logWithTimestamp("🔍 Starting comprehensive check process");

    const reportSource = source.directory("packages/report");
    const dataSource = source.directory("packages/data");

    logWithTimestamp("📁 Prepared source directories for all packages");

    // Get data source for dependencies
    const dataSourceDir = await withTiming("data source preparation", () =>
      Promise.resolve(getDataSource(dataSource))
    );

    // Run checks in parallel
    const [_backendCheck, _reportCheck, _dataCheck] = await withTiming(
      "parallel package checks",
      async () => {
        logWithTimestamp("🔄 Running package checks in parallel...");
        return Promise.all([
          withTiming("backend check", () =>
            Promise.resolve(checkBackend(source))
          ),
          withTiming("report check", () =>
            Promise.resolve(checkReport(reportSource, dataSourceDir))
          ),
          withTiming("data check", () =>
            Promise.resolve(checkData(dataSource))
          ),
        ]);
      }
    );

    logWithTimestamp("🎉 All checks completed successfully");
    return "All checks completed successfully";
  }

  /**
   * Build all packages (backend image, report npm package)
   * @param source The source directory
   * @param version The version to build
   * @param gitSha The git SHA
   * @returns A message indicating completion
   */
  @func()
  async build(
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string
  ): Promise<string> {
    logWithTimestamp(
      `🔨 Starting build process for version ${version} (${gitSha})`
    );

    const reportSource = source.directory("packages/report");
    const dataSource = source.directory("packages/data");

    logWithTimestamp("📁 Prepared source directories for build");

    // Get data source for dependencies
    const dataSourceDir = await withTiming("data source preparation", () =>
      Promise.resolve(getDataSource(dataSource))
    );

    // Build backend image and report npm package in parallel
    const [_backendImage, _reportNpm] = await withTiming(
      "parallel package builds",
      async () => {
        logWithTimestamp(
          "🔄 Building backend image and report npm package in parallel..."
        );
        return Promise.all([
          withTiming("backend Docker image build", async () => {
            const image = buildBackendImage(source, version, gitSha);
            // Force the container to be evaluated by getting its ID
            await image.id();
            return image;
          }),
          withTiming("report npm package build", () =>
            Promise.resolve(
              buildReportForNpm(reportSource, dataSourceDir, version)
            )
          ),
        ]);
      }
    );

    // Smoke test the backend image
    await withTiming("backend image smoke test", async () => {
      logWithTimestamp("🧪 Running smoke test on backend image...");
      const smokeTestResult = await smokeTestBackendImage(
        source,
        version,
        gitSha
      );
      logWithTimestamp(`Smoke test result: ${smokeTestResult}`);

      // If smoke test indicates failure, throw an error
      if (smokeTestResult.startsWith("❌")) {
        throw new Error(`Backend image smoke test failed: ${smokeTestResult}`);
      }
    });

    logWithTimestamp("🎉 All packages built successfully");
    return "All packages built successfully";
  }

  /**
   * Run the full CI pipeline
   * @param source The source directory
   * @param version The version to build
   * @param gitSha The git SHA
   * @param ghcrUsername The GitHub Container Registry username (optional)
   * @param ghcrPassword The GitHub Container Registry password/token (optional)
   * @param env The environment (prod/dev) - determines if images are published
   * @param ghToken The GitHub token for creating deployment PRs (optional)
   * @returns A message indicating completion
   */
  @func()
  async ci(
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
    ghcrUsername?: string,
    ghcrPassword?: Secret,
    env?: string,
    ghToken?: Secret
  ): Promise<string> {
    logWithTimestamp(
      `🚀 Starting CI pipeline for version ${version} (${gitSha}) in ${env ?? "dev"} environment`
    );

    // First run checks
    await withTiming("CI checks phase", () => {
      logWithTimestamp("📋 Phase 1: Running checks...");
      return this.check(source);
    });

    // Then build
    await withTiming("CI build phase", () => {
      logWithTimestamp("🔨 Phase 2: Building packages...");
      return this.build(source, version, gitSha);
    });

    // Publish images if credentials provided and environment is prod
    const shouldPublish = ghcrUsername && ghcrPassword && env === "prod";
    if (shouldPublish) {
      await withTiming("CI publish phase", async () => {
        logWithTimestamp("📦 Phase 3: Publishing Docker image to registry...");

        // Login to registry and publish
        const publishedRefs = await publishBackendImage(
          source,
          version,
          gitSha,
          ghcrUsername,
          ghcrPassword
        );

        logWithTimestamp(`✅ Images published: ${publishedRefs.join(", ")}`);
      });
    } else {
      logWithTimestamp(
        "⏭️ Phase 3: Skipping image publishing (no credentials or not prod environment)"
      );
    }

    // Deploy to beta - always deploy, but only create PR if GitHub token is provided
    const deployStage = env === "prod" ? "beta" : "dev";
    await withTiming("CI deploy phase", () => {
      logWithTimestamp(`🚀 Phase 4: Deploying to ${deployStage}...`);
      return this.deploy(source, version, deployStage, ghToken);
    });

    logWithTimestamp("🎉 CI pipeline completed successfully");
    return "CI pipeline completed successfully";
  }

  /**
   * Deploy to the specified stage
   * @param source The source directory
   * @param version The version to deploy
   * @param stage The stage to deploy to
   * @param ghToken The GitHub token secret
   * @returns A message indicating completion
   */
  @func()
  async deploy(
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() stage: string,
    ghToken?: Secret
  ): Promise<string> {
    logWithTimestamp(
      `🚀 Starting deployment to ${stage} stage for version ${version}`
    );

    const container = await withTiming("GitHub repository setup", () => {
      logWithTimestamp("📦 Setting up GitHub container...");
      return Promise.resolve(
        getGitHubContainer()
          .withExec([
            "git",
            "clone",
            "--branch=main",
            "https://github.com/shepherdjerred/homelab",
            ".",
          ])
          .withExec([
            "git",
            "remote",
            "set-url",
            "origin",
            "https://github.com/shepherdjerred/homelab",
          ])
          .withExec(["git", "fetch", "--depth=2"])
          .withExec(["git", "checkout", "main"])
          .withExec(["git", "pull", "origin", "main"])
      );
    });

    logWithTimestamp(
      `📝 Updating version file for ${stage} stage to ${version}`
    );
    const updatedContainer = await withTiming("version file update", () => {
      return Promise.resolve(
        container
          .withExec([
            "sed",
            "-i",
            `s/"shepherdjerred\\/scout-for-lol\\/${stage}": ".*"/"shepherdjerred\\/scout-for-lol\\/${stage}": "${version}"/`,
            "src/cdk8s/src/versions.ts",
          ])
          .withExec(["git", "add", "."])
          .withExec(["git", "checkout", "-b", `scout/${version}`])
          .withExec([
            "git",
            "commit",
            "-m",
            `chore: update scout-for-lol version to ${version}`,
          ])
      );
    });

    if (ghToken) {
      logWithTimestamp(
        "🔐 GitHub token provided, proceeding with PR creation..."
      );

      const result = await withTiming(
        "GitHub PR creation and merge",
        async () => {
          logWithTimestamp("🔑 Setting up GitHub authentication...");
          return await updatedContainer
            .withSecretVariable("GH_TOKEN", ghToken)
            .withExec(["gh", "auth", "setup-git"])
            .withExec([
              "git",
              "push",
              "--set-upstream",
              "origin",
              `scout/${version}`,
            ])
            .withExec([
              "gh",
              "pr",
              "create",
              "--title",
              `chore: update scout-for-lol version to ${version}`,
              "--body",
              `This PR updates the scout-for-lol version to ${version}`,
              "--base",
              "main",
              "--head",
              `scout/${version}`,
            ])
            .withExec(["gh", "pr", "merge", "--auto", "--rebase"])
            .stdout();
        }
      );

      logWithTimestamp(`✅ Deployment to ${stage} completed successfully`);
      return `Deployment to ${stage} completed: ${result}`;
    }

    logWithTimestamp(
      `⚠️ No GitHub token provided - deployment to ${stage} prepared but not executed`
    );
    return `Deployment to ${stage} prepared (no GitHub token provided)`;
  }

  /**
   * Generate Prisma client for the backend package
   * @param source The backend source directory
   * @returns The generated Prisma client
   */
  @func()
  async generatePrisma(
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: "packages/backend",
    })
    source: Directory
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
          .withExec(["bun", "run", "src/database/generate.ts"])
          .withExec(["rm", "-f", "generated/client/runtime/edge-esm.cjs"])
          .directory("/workspace/packages/backend/generated")
      );
    });

    logWithTimestamp("✅ Prisma client generated successfully");
    return result;
  }

  /**
   * Check the backend package
   * @param source The backend source directory
   * @returns A message indicating completion
   */
  @func()
  async checkBackend(
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: "packages/backend",
    })
    source: Directory
  ): Promise<string> {
    logWithTimestamp("🔍 Starting backend package check");

    await withTiming("backend package check", () =>
      Promise.resolve(checkBackend(source))
    );

    logWithTimestamp("✅ Backend check completed successfully");
    return "Backend check completed successfully";
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
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string
  ): Promise<Container> {
    logWithTimestamp(
      `🐳 Building backend Docker image for version ${version} (${gitSha})`
    );

    const result = await withTiming("backend Docker image build", () =>
      Promise.resolve(buildBackendImage(source, version, gitSha))
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
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
    registryUsername?: string,
    registryPassword?: Secret
  ): Promise<string[]> {
    logWithTimestamp(
      `📦 Publishing backend Docker image for version ${version} (${gitSha})`
    );

    const result = await withTiming("backend Docker image publish", () =>
      publishBackendImage(
        source,
        version,
        gitSha,
        registryUsername,
        registryPassword
      )
    );

    logWithTimestamp(
      `✅ Backend Docker image published successfully: ${result.join(", ")}`
    );
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
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string
  ): Promise<string> {
    logWithTimestamp(
      `🧪 Smoke testing backend Docker image for version ${version} (${gitSha})`
    );

    const result = await withTiming("backend Docker image smoke test", () =>
      smokeTestBackendImage(source, version, gitSha)
    );

    logWithTimestamp("✅ Backend Docker image smoke test completed");
    return result;
  }

  /**
   * Check the report package
   * @param source The report source directory
   * @param dataSource The data source directory
   * @returns A message indicating completion
   */
  @func()
  async checkReport(
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: "packages/report",
    })
    source: Directory,
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: "packages/data",
    })
    dataSource: Directory
  ): Promise<string> {
    logWithTimestamp("🔍 Starting report package check");

    await withTiming("report package check", () =>
      Promise.resolve(checkReport(source, getDataSource(dataSource)))
    );

    logWithTimestamp("✅ Report check completed successfully");
    return "Report check completed successfully";
  }

  /**
   * Build the report package for npm
   * @param source The report source directory
   * @param dataSource The data source directory
   * @param version The version to build
   * @returns The built npm package directory
   */
  @func()
  async buildReportForNpm(
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: "packages/report",
    })
    source: Directory,
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: "packages/data",
    })
    dataSource: Directory,
    @argument() version: string
  ): Promise<Directory> {
    logWithTimestamp(`📦 Building report package for npm version ${version}`);

    const result = await withTiming("report npm package build", () =>
      Promise.resolve(
        buildReportForNpm(source, getDataSource(dataSource), version)
      )
    );

    logWithTimestamp("✅ Report npm package built successfully");
    return result;
  }

  /**
   * Publish the report package to npm
   * @param source The report source directory
   * @param dataSource The data source directory
   * @param version The version to publish
   * @param npmToken The npm token secret
   * @returns The publish result
   */
  @func()
  async publishReportToNpm(
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: "packages/report",
    })
    source: Directory,
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: "packages/data",
    })
    dataSource: Directory,
    @argument() version: string,
    npmToken: Secret
  ): Promise<string> {
    logWithTimestamp(`📦 Publishing report package to npm version ${version}`);

    const result = await withTiming("report npm package publish", () =>
      publishReportToNpm(source, getDataSource(dataSource), version, npmToken)
    );

    logWithTimestamp(
      `✅ Report package published to npm successfully: ${result}`
    );
    return result;
  }

  /**
   * Check the data package
   * @param source The data source directory
   * @returns A message indicating completion
   */
  @func()
  async checkData(
    @argument({
      ignore: [
        "node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "generated",
      ],
      defaultPath: "packages/data",
    })
    source: Directory
  ): Promise<string> {
    logWithTimestamp("🔍 Starting data package check");

    await withTiming("data package check", () =>
      Promise.resolve(checkData(source))
    );

    logWithTimestamp("✅ Data check completed successfully");
    return "Data check completed successfully";
  }
}
