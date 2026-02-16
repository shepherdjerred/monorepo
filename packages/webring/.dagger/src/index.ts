import { func, argument, Directory, object, Container, dag, Secret } from "@dagger.io/dagger";
import {
  logWithTimestamp,
  withTiming,
  getBunContainerWithCache,
  releasePr as sharedReleasePr,
  githubRelease as sharedGithubRelease,
} from "@shepherdjerred/dagger-utils";
import { syncToS3 } from "@shepherdjerred/dagger-utils/containers";

@object()
export class Webring {
  /**
   * Install dependencies
   * @param source The source directory
   * @returns A container with dependencies installed
   */
  @func()
  deps(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Container {
    logWithTimestamp("📦 Installing dependencies");

    const container = getBunContainerWithCache(source, "latest").withExec(["bun", "install", "--frozen-lockfile"]);

    return container;
  }

  /**
   * Run linting
   * @param source The source directory
   * @returns A message indicating completion
   */
  @func()
  async lint(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    logWithTimestamp("🔍 Running linting");

    const depsContainer = this.deps(source);

    const result = await withTiming("lint", async () => {
      return depsContainer.withExec(["bun", "run", "lint"]).stdout();
    });

    logWithTimestamp("✅ Linting completed successfully");
    return result;
  }

  /**
   * Build the project
   * @param source The source directory
   * @returns A directory containing the built artifacts
   */
  @func()
  async build(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<Directory> {
    logWithTimestamp("🔨 Building project");

    const depsContainer = this.deps(source);

    const buildDir = await withTiming("build", () => {
      return depsContainer.withExec(["bun", "run", "build"]).directory("dist");
    });

    logWithTimestamp("✅ Build completed successfully");
    return buildDir;
  }

  /**
   * Run tests
   * @param source The source directory
   * @returns A message indicating completion
   */
  @func()
  async test(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    logWithTimestamp("🧪 Running tests");

    // First build the project
    const buildDir = await this.build(source);
    const depsContainer = this.deps(source);

    const result = await withTiming("test", async () => {
      // Run unit tests
      const testResult = await depsContainer.withExec(["bun", "run", "test", "--", "--run"]).stdout();

      // Test example app - manually link dist to avoid recursive symlinks
      // The example's package.json has "webring": "../" which creates a symlink
      // to the parent directory. Running "bun install" creates example/node_modules/webring -> ../
      // which recursively includes example/ itself, corrupting the Dagger cache.
      // Instead, we manually set up the node_modules with the built dist.
      //
      // IMPORTANT: We must NOT run "bun install" in the example directory at all,
      // because even with --ignore-scripts, bun still creates the symlink before
      // we can remove it, and Dagger snapshots this corrupted state.
      // Instead, we modify package.json to remove webring before installing.
      const exampleContainer = getBunContainerWithCache(source, "latest")
        .withDirectory("dist", buildDir)
        .withExec(["bun", "install", "--frozen-lockfile"])
        .withWorkdir("/workspace/example")
        // Remove webring dependency from package.json before installing to prevent symlink creation
        // Using bun to properly modify JSON without leaving trailing commas
        .withExec([
          "bun",
          "-e",
          "const pkg = JSON.parse(await Bun.file('package.json').text()); delete pkg.dependencies.webring; await Bun.write('package.json', JSON.stringify(pkg, null, 2));",
        ])
        // Now install deps - this won't create the problematic symlink
        .withExec(["bun", "install"])
        // Manually add the built dist as webring package
        // The package.json expects main: "dist/index.js" so we need to preserve that structure
        .withExec(["mkdir", "-p", "node_modules/webring/dist"])
        .withExec(["cp", "-r", "../dist/.", "node_modules/webring/dist/"])
        .withExec(["cp", "../package.json", "node_modules/webring/"]);

      await exampleContainer.withExec(["bun", "run", "build"]).stdout();

      return testResult;
    });

    logWithTimestamp("✅ Tests completed successfully");
    return result;
  }

  /**
   * Run the full CI pipeline
   * @param source The source directory
   * @returns A message indicating completion
   */
  @func()
  async ci(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    logWithTimestamp("🚀 Starting CI pipeline");

    // Run all steps in parallel where possible
    const [lintResult, _buildResult] = await withTiming("parallel lint and build", async () => {
      return Promise.all([this.lint(source), this.build(source)]);
    });

    // Run tests after build is complete
    const testResult = await withTiming("test", () => this.test(source));

    logWithTimestamp("🎉 CI pipeline completed successfully");
    return `CI pipeline completed successfully:\n- Lint: ${lintResult}\n- Build: completed\n- Test: ${testResult}`;
  }

  /**
   * Build TypeDoc documentation
   * @param source The source directory
   * @returns A directory containing the TypeDoc documentation
   */
  @func()
  async buildDocs(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<Directory> {
    logWithTimestamp("📚 Building TypeDoc documentation");

    const depsContainer = this.deps(source);

    const docsDir = await withTiming("typedoc", () => {
      return depsContainer.withExec(["bun", "run", "typedoc"]).directory("docs");
    });

    logWithTimestamp("✅ TypeDoc documentation built successfully");
    return docsDir;
  }

  /**
   * Deploy docs to S3 (SeaweedFS)
   * @param source The source directory
   * @param s3AccessKeyId S3 access key ID
   * @param s3SecretAccessKey S3 secret access key
   * @returns The sync output
   */
  @func()
  async deployDocsToS3(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() s3AccessKeyId: Secret,
    @argument() s3SecretAccessKey: Secret,
  ): Promise<string> {
    logWithTimestamp("🚀 Deploying docs to S3");

    const docsDir = await this.buildDocs(source);

    const syncOutput = await syncToS3({
      sourceDir: docsDir,
      bucketName: "webring",
      endpointUrl: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      region: "us-east-1",
      deleteRemoved: true,
    });

    logWithTimestamp("✅ Docs deployed to S3 successfully");
    return syncOutput;
  }

  /**
   * Generate typedoc documentation
   * @param source The source directory
   * @returns A directory containing the generated docs
   */
  @func()
  async typedoc(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<Directory> {
    logWithTimestamp("📚 Generating typedoc documentation");

    const depsContainer = this.deps(source);

    const docsDir = await withTiming("typedoc", () => {
      return depsContainer.withExec(["bun", "run", "typedoc"]).directory("docs");
    });

    logWithTimestamp("✅ Typedoc generation completed successfully");
    return docsDir;
  }

  /**
   * Publish package to npm
   * @param source The source directory
   * @param npmToken NPM token for publishing
   * @returns A message indicating completion
   */
  @func()
  async publish(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    @argument()
    npmToken: Secret,
  ): Promise<string> {
    logWithTimestamp("📦 Publishing to npm");

    const depsContainer = this.deps(source);

    const result = await withTiming("publish", async () => {
      return depsContainer
        .withExec(["bun", "run", "build"])
        .withSecretVariable("NPM_TOKEN", npmToken)
        .withExec([
          "sh",
          "-c",
          'echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc && bun publish --ignore-scripts',
        ])
        .stdout();
    });

    logWithTimestamp("✅ Published to npm successfully");
    return result;
  }

  /**
   * Run CI and handle release logic (for main branch pushes).
   * Combines ci, release-please, and publish into a single entry point.
   * @param source The source directory
   * @param env The environment (dev or prod)
   * @param repoUrl The repository URL (e.g., "shepherdjerred/webring")
   * @param githubToken GitHub token for release-please
   * @param npmToken NPM token for publishing (only needed for prod)
   * @param s3AccessKeyId S3 access key ID for docs deployment
   * @param s3SecretAccessKey S3 secret access key for docs deployment
   */
  @func()
  async ciWithRelease(
    @argument({
      ignore: ["**/node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger", "generated"],
      defaultPath: ".",
    })
    source: Directory,
    env = "dev",
    repoUrl?: string,
    githubToken?: Secret,
    npmToken?: Secret,
    s3AccessKeyId?: Secret,
    s3SecretAccessKey?: Secret,
  ): Promise<string> {
    const isProd = env === "prod";

    return withTiming("ci-with-release", async () => {
      // Always run CI first
      await this.ci(source);

      if (isProd) {
        // For prod, also handle release-please flow
        if (!repoUrl || !githubToken) {
          throw new Error("repoUrl and githubToken are required for prod environment");
        }

        // Create/update release PR
        const releasePrResult = await withTiming("release-pr", async () => {
          return sharedReleasePr({
            ghToken: githubToken,
            repoUrl,
            releaseType: "node",
          });
        });
        logWithTimestamp(`Release PR: ${releasePrResult}`);

        // Try to create GitHub release (only succeeds if release PR was just merged)
        const githubReleaseResult = await withTiming("github-release", async () => {
          return sharedGithubRelease({
            ghToken: githubToken,
            repoUrl,
            releaseType: "node",
          });
        });
        logWithTimestamp(`GitHub Release: ${githubReleaseResult}`);

        // If a release was created and we have an npm token, publish
        const releaseCreated = githubReleaseResult.includes("github.com") && githubReleaseResult.includes("releases");
        if (releaseCreated && npmToken) {
          await this.publish(source, npmToken);
        }

        // Deploy docs to S3
        if (s3AccessKeyId && s3SecretAccessKey) {
          await withTiming("deploy docs to S3", async () => {
            return this.deployDocsToS3(source, s3AccessKeyId, s3SecretAccessKey);
          });
        } else {
          logWithTimestamp("⏭️ Skipping docs deployment (missing S3 credentials)");
        }
      }

      logWithTimestamp("🎉 CI with release completed successfully");
      return "CI with release completed successfully";
    });
  }
}
