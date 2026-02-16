import { func, argument, Directory, object, Secret, Container, dag } from "@dagger.io/dagger";
import { logWithTimestamp, withTiming } from "@shepherdjerred/dagger-utils/utils";
import { syncToS3 } from "@shepherdjerred/dagger-utils/containers";

// Get a Bun container with the specified version (for simple operations like lint)
function getBunContainer(version = "latest"): Container {
  return dag
    .container()
    .from(`oven/bun:${version}`)
    .withWorkdir("/workspace")
    .withEnvVariable("PUPPETEER_SKIP_DOWNLOAD", "1");
}

// Get a container with Playwright + Bun for operations that need browser (build, test)
// Uses official Playwright image with Bun installed on top
function getPlaywrightContainer(): Container {
  return (
    dag
      .container()
      .from("mcr.microsoft.com/playwright:v1.57.0-noble")
      .withWorkdir("/workspace")
      // Install unzip (required for Bun installer)
      .withExec(["apt-get", "update"])
      .withExec(["apt-get", "install", "-y", "unzip"])
      // Install Bun
      .withExec(["sh", "-c", "curl -fsSL https://bun.sh/install | bash"])
      .withEnvVariable("PATH", "/root/.bun/bin:$PATH", { expand: true })
  );
}

// Install deps on a given base container
function installDeps(baseContainer: Container, source: Directory): Container {
  return baseContainer
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    .withDirectory("/workspace", source)
    .withExec(["bun", "install", "--frozen-lockfile"]);
}

@object()
export class SjerRed {
  /**
   * Install dependencies (simple container, no Playwright)
   * @param source The source directory
   * @returns A container with dependencies installed
   */
  @func()
  async deps(
    @argument({
      ignore: [
        "**/node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "test/index.spec.ts-snapshots",
      ],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<Container> {
    return withTiming("install dependencies", () => {
      const container = installDeps(getBunContainer(), source);
      logWithTimestamp("Dependencies installed successfully");
      return Promise.resolve(container);
    });
  }

  /**
   * Install dependencies with Playwright support (for build/test)
   * @param source The source directory
   * @returns A container with dependencies and Playwright installed
   */
  @func()
  async depsWithPlaywright(
    @argument({
      ignore: [
        "**/node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "test/index.spec.ts-snapshots",
      ],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<Container> {
    return withTiming("install dependencies with Playwright", () => {
      const container = installDeps(getPlaywrightContainer(), source);
      logWithTimestamp("Dependencies with Playwright installed successfully");
      return Promise.resolve(container);
    });
  }

  /**
   * Build the website (requires Playwright for OG image generation)
   * @param source The source directory
   * @returns The built website directory
   */
  @func()
  async build(
    @argument({
      ignore: [
        "**/node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "test/index.spec.ts-snapshots",
      ],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<Directory> {
    return withTiming("build website", async () => {
      // Build requires Playwright for MDX/OG image processing
      const container = await this.depsWithPlaywright(source);

      const builtContainer = container
        .withMountedCache("/webring-cache", dag.cacheVolume("webring-cache"))
        .withEnvVariable("WEBRING_CACHE_DIR", "/webring-cache")
        .withExec(["bun", "run", "build"]);

      const distDir = builtContainer.directory("/workspace/dist");
      logWithTimestamp("Website built successfully");
      return distDir;
    });
  }

  /**
   * Run linting
   * @param source The source directory
   * @returns A success message
   */
  @func()
  async lint(
    @argument({
      ignore: [
        "**/node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "test/index.spec.ts-snapshots",
      ],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    return withTiming("lint code", async () => {
      const container = await this.deps(source);

      // Generate Astro types before linting
      await container.withExec(["bunx", "astro", "sync"]).withExec(["bun", "run", "lint"]).sync();

      logWithTimestamp("Linting completed successfully");
      return "✅ Linting passed";
    });
  }

  /**
   * Run tests with official Playwright Docker image
   * @param source The source directory
   * @returns A success message
   */
  @func()
  async testOfficial(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    return withTiming("run tests (official image)", async () => {
      const container = await this.depsWithPlaywright(source);
      const distDir = await this.build(source);

      // Run tests with Bun
      const result = await container
        .withDirectory("/workspace/dist", distDir)
        .withEnvVariable("CI", "true")
        .withExec(["bun", "run", "test", "--project=chromium", "--max-failures=1"])
        .stdout();

      logWithTimestamp("Tests completed successfully");
      return result || "✅ Tests passed";
    });
  }

  /**
   * Run tests
   * @param source The source directory
   * @returns A success message
   */
  @func()
  async test(
    @argument({
      ignore: [
        "**/node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "test/index.spec.ts-snapshots",
      ],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    return withTiming("run tests", async () => {
      const container = await this.depsWithPlaywright(source);
      const distDir = await this.build(source);

      const testContainer = container
        .withDirectory("/workspace/dist", distDir)
        .withEnvVariable("CI", "true")
        .withExec(["bun", "run", "test"]);

      await testContainer.sync();

      logWithTimestamp("Tests completed successfully");
      return "✅ Tests passed";
    });
  }

  /**
   * Deploy the built site to S3 (SeaweedFS)
   * @param source The source directory
   * @param s3AccessKeyId S3 access key ID
   * @param s3SecretAccessKey S3 secret access key
   * @returns The sync output
   */
  @func()
  async deployToS3(
    @argument({
      ignore: [
        "**/node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "test/index.spec.ts-snapshots",
      ],
      defaultPath: ".",
    })
    source: Directory,
    @argument() s3AccessKeyId: Secret,
    @argument() s3SecretAccessKey: Secret,
  ): Promise<string> {
    return withTiming("deploy to S3", async () => {
      const distDir = await this.build(source);

      const syncOutput = await syncToS3({
        sourceDir: distDir,
        bucketName: "sjer-red",
        endpointUrl: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
        region: "us-east-1",
        deleteRemoved: true,
      });

      logWithTimestamp("Deployed to S3 successfully");
      return syncOutput;
    });
  }

  /**
   * Run the complete CI pipeline
   * @param source The source directory
   * @param branch The git branch name
   * @param version The version tag (e.g., 1.0.123)
   * @param date The current date (YYYY-MM-DD) for cache busting on scheduled builds
   * @param s3AccessKeyId S3 access key ID (optional, for deployment)
   * @param s3SecretAccessKey S3 secret access key (optional, for deployment)
   * @returns A success message
   */
  @func()
  async ci(
    @argument({
      ignore: [
        "**/node_modules",
        "dist",
        "build",
        ".cache",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        // Include snapshots for visual regression testing
      ],
      defaultPath: ".",
    })
    source: Directory,
    @argument() branch: string,
    @argument() version: string,
    @argument() date: string,
    s3AccessKeyId?: Secret,
    s3SecretAccessKey?: Secret,
  ): Promise<string> {
    return withTiming("CI pipeline", async () => {
      logWithTimestamp(`🚀 Starting CI pipeline (date: ${date})`);

      // Run checks in parallel
      const [_, __, ___] = await Promise.all([
        withTiming("lint", () => this.lint(source)),
        withTiming("test", () => this.testOfficial(source)),
        withTiming("build", () => this.build(source)),
      ]);

      logWithTimestamp("✅ All checks passed");

      // Deploy to S3 if credentials are provided and on main branch
      if (s3AccessKeyId && s3SecretAccessKey && branch === "main") {
        await this.deployToS3(source, s3AccessKeyId, s3SecretAccessKey);
        return `✅ CI pipeline completed and deployed to S3 (branch: ${branch}, version: ${version})`;
      }

      return `✅ CI pipeline completed successfully (branch: ${branch}, version: ${version})`;
    });
  }
}
