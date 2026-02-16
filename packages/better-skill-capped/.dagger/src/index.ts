import { func, argument, Directory, object, Secret, Container, dag } from "@dagger.io/dagger";
import { updateHomelabVersion, syncToS3 } from "@shepherdjerred/dagger-utils/containers";

// Helper function to log with timestamp
function logWithTimestamp(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
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
    logWithTimestamp(
      `❌ ${operation} failed after ${duration.toString()}ms: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

const BUN_VERSION = "1.3.4";

/**
 * Get a Bun container
 */
function getBunContainer(): Container {
  return dag
    .container()
    .from(`oven/bun:${BUN_VERSION}`)
    .withWorkdir("/workspace")
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"));
}

@object()
export class BetterSkillCapped {
  /**
   * Install dependencies for the main app
   */
  @func()
  async deps(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "fetcher"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<Container> {
    logWithTimestamp("📦 Installing main app dependencies");

    return getBunContainer().withMountedDirectory("/workspace", source).withExec(["bun", "install", "--frozen-lockfile"]);
  }

  /**
   * Lint the main application
   */
  @func()
  async lint(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "fetcher"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    logWithTimestamp("🔍 Linting main application");

    await withTiming("linting", async () => {
      const container = await this.deps(source);
      await container.withExec(["bun", "run", "lint:fix"]);
    });

    return "✅ Linting completed successfully";
  }

  /**
   * Build the main application
   */
  @func()
  async build(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "fetcher"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<Directory> {
    logWithTimestamp("🏗️ Building main application");

    const buildResult = await withTiming("building", async () => {
      const container = await this.deps(source);
      return container.withExec(["bun", "run", "build"]);
    });

    return buildResult.directory("/workspace/dist");
  }

  /**
   * Deploy fetcher to Kubernetes by updating homelab version and creating a PR
   * Note: Frontend is now deployed to S3, not Kubernetes
   */
  @func()
  async deploy(@argument() version: string, ghToken?: Secret): Promise<string> {
    logWithTimestamp(`🚀 Deploying fetcher version ${version} to Kubernetes`);

    if (!ghToken) {
      logWithTimestamp("⚠️ No GitHub token provided - deployment skipped");
      return "Deployment skipped (no GitHub token provided)";
    }

    // Update only fetcher version in homelab (frontend uses S3 now)
    await withTiming("update homelab version", async () => {
      await updateHomelabVersion({
        ghToken,
        appName: "better-skill-capped-fetcher",
        version,
      });
    });

    logWithTimestamp(`✅ Fetcher deployment PR created for version ${version}`);
    return `✅ Fetcher deployment completed - PR created for version ${version}`;
  }

  /**
   * Install dependencies for the fetcher
   */
  @func()
  async fetcherDeps(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: "fetcher",
    })
    source: Directory,
  ): Promise<Container> {
    logWithTimestamp("📦 Installing fetcher dependencies");

    return getBunContainer().withMountedDirectory("/workspace", source).withExec(["bun", "install", "--frozen-lockfile"]);
  }

  /**
   * Build the fetcher worker
   */
  @func()
  async fetcherBuild(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: "fetcher",
    })
    source: Directory,
  ): Promise<string> {
    logWithTimestamp("🏗️ Building fetcher worker");

    await withTiming("fetcher build", async () => {
      const container = await this.fetcherDeps(source);
      await container.withExec(["bun", "run", "build"]);
    });

    return "✅ Fetcher build completed successfully";
  }

  /**
   * Deploy frontend to S3 (SeaweedFS)
   */
  @func()
  async deployFrontendToS3(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "fetcher"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() s3AccessKeyId: Secret,
    @argument() s3SecretAccessKey: Secret,
  ): Promise<string> {
    logWithTimestamp("🚀 Deploying frontend to S3");

    const dist = await this.build(source);

    const syncOutput = await syncToS3({
      sourceDir: dist,
      bucketName: "better-skill-capped",
      endpointUrl: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      region: "us-east-1",
      deleteRemoved: true,
    });

    logWithTimestamp("✅ Frontend deployed to S3 successfully");
    return syncOutput;
  }

  /**
   * Build a container for the fetcher CronJob
   */
  @func()
  async buildFetcherContainer(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: "fetcher",
    })
    source: Directory,
  ): Promise<Container> {
    logWithTimestamp("🐳 Building fetcher container");

    const container = getBunContainer()
      .withDirectory("/workspace", source)
      .withExec(["bun", "install", "--frozen-lockfile"])
      .withEntrypoint(["bun", "run", "src/index.ts"]);

    logWithTimestamp("✅ Fetcher container built successfully");
    return container;
  }

  /**
   * Publish the fetcher container to GHCR
   */
  @func()
  async publishFetcher(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: "fetcher",
    })
    source: Directory,
    @argument() imageName: string,
    @argument() ghcrUsername: string,
    ghcrPassword: Secret,
  ): Promise<string> {
    logWithTimestamp(`📦 Publishing fetcher to ${imageName}`);

    const container = await this.buildFetcherContainer(source);

    const publishedRef = await withTiming("publish fetcher to GHCR", async () => {
      return container.withRegistryAuth("ghcr.io", ghcrUsername, ghcrPassword).publish(imageName);
    });

    logWithTimestamp(`✅ Fetcher published: ${publishedRef}`);
    return publishedRef;
  }

  /**
   * Run the complete CI pipeline
   */
  @func()
  async ci(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() branch: string,
    ghcrUsername?: string,
    ghcrPassword?: Secret,
    ghToken?: Secret,
    s3AccessKeyId?: Secret,
    s3SecretAccessKey?: Secret,
  ): Promise<string> {
    logWithTimestamp(`🚀 Running CI pipeline for version ${version} (branch: ${branch})`);

    const mainSource = source.withoutDirectory("fetcher");
    const fetcherSource = source.directory("fetcher");

    // Run lint and build in parallel
    const [_lintResult, _buildResult, _fetcherBuildResult] = await Promise.all([
      withTiming("main lint", () => this.lint(mainSource)),
      withTiming("main build", () => this.build(mainSource)),
      withTiming("fetcher build", () => this.fetcherBuild(fetcherSource)),
    ]);

    logWithTimestamp("✅ Build and lint completed successfully");

    const isProduction = branch === "main";

    if (!isProduction) {
      return "✅ CI pipeline completed successfully (checks only, no deployment)";
    }

    // Production: deploy frontend to S3 and publish fetcher image
    if (!s3AccessKeyId || !s3SecretAccessKey) {
      logWithTimestamp("⚠️ S3 credentials not provided - skipping frontend deployment");
    } else {
      await withTiming("deploy frontend to S3", async () => {
        await this.deployFrontendToS3(mainSource, s3AccessKeyId, s3SecretAccessKey);
      });
      logWithTimestamp("✅ Frontend deployed to S3");
    }

    if (!ghcrUsername || !ghcrPassword) {
      logWithTimestamp("⚠️ GHCR credentials not provided - skipping fetcher publish");
    } else {
      // Publish fetcher image
      const fetcherImage = "ghcr.io/shepherdjerred/better-skill-capped-fetcher";

      await withTiming("publish fetcher image", async () => {
        await Promise.all([
          this.publishFetcher(fetcherSource, `${fetcherImage}:${version}`, ghcrUsername, ghcrPassword),
          this.publishFetcher(fetcherSource, `${fetcherImage}:latest`, ghcrUsername, ghcrPassword),
        ]);
      });

      logWithTimestamp("✅ Fetcher image published to GHCR");
    }

    // Deploy fetcher to Kubernetes via homelab PR (only fetcher now)
    if (ghToken && ghcrUsername && ghcrPassword) {
      await withTiming("deploy fetcher to kubernetes", async () => {
        await updateHomelabVersion({
          ghToken,
          appName: "better-skill-capped-fetcher",
          version,
        });
      });
    }

    return "✅ CI pipeline completed successfully with production deployment";
  }
}
