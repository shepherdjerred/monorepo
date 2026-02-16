import { argument, dag, Directory, func, object, Secret } from "@dagger.io/dagger";
import type { Container } from "@dagger.io/dagger";
import {
  withTiming,
  releasePr as sharedReleasePr,
  githubRelease as sharedGithubRelease,
} from "@shepherdjerred/dagger-utils";

const WORKDIR = "/workspace";
const BUN_CACHE = "astro-opengraph-images-bun-cache";
const ROOT_NODE_MODULES_CACHE = "astro-opengraph-images-root-node-modules";

@object()
export class AstroOpengraphImages {
  /**
   * Run linting on the project
   */
  @func()
  async lint(
    @argument({ defaultPath: "." })
    source: Directory,
  ): Promise<string> {
    return withTiming("lint", async () => {
      const deps = this.installDependencies(source);
      return deps.withExec(["bun", "run", "lint"]).stdout();
    });
  }

  /**
   * Build the project
   */
  @func()
  async build(
    @argument({ defaultPath: "." })
    source: Directory,
  ): Promise<string> {
    return withTiming("build", async () => {
      const build = this.buildRoot(source);
      return build.stdout();
    });
  }

  /**
   * Run unit tests
   */
  @func()
  async test(
    @argument({ defaultPath: "." })
    source: Directory,
  ): Promise<string> {
    return withTiming("test", async () => {
      const deps = this.installDependencies(source);
      return deps.withExec(["bun", "run", "test"]).stdout();
    });
  }

  /**
   * Run the complete CI pipeline
   */
  @func()
  async ci(
    @argument({ defaultPath: "." })
    source: Directory,
  ): Promise<string> {
    return withTiming("ci", async () => {
      const deps = this.installDependencies(source);

      await withTiming("lint", () => deps.withExec(["bun", "run", "lint"]).stdout());

      await withTiming("build", () => deps.withExec(["bun", "run", "build"]).stdout());

      await withTiming("test", () => deps.withExec(["bun", "run", "test"]).stdout());

      return "CI pipeline completed successfully.";
    });
  }

  /**
   * Create or update a release PR based on conventional commits
   */
  @func()
  async releasePr(
    @argument()
    githubToken: Secret,
    @argument()
    repoUrl: string,
  ): Promise<string> {
    return withTiming("release-pr", async () => {
      return sharedReleasePr({
        ghToken: githubToken,
        repoUrl,
        releaseType: "node",
      });
    });
  }

  /**
   * Create a GitHub release when a release PR has been merged
   */
  @func()
  async githubRelease(
    @argument()
    githubToken: Secret,
    @argument()
    repoUrl: string,
  ): Promise<string> {
    return withTiming("github-release", async () => {
      return sharedGithubRelease({
        ghToken: githubToken,
        repoUrl,
        releaseType: "node",
      });
    });
  }

  /**
   * Publish package to npm (runs CI first)
   */
  @func()
  async publish(
    @argument({ defaultPath: "." })
    source: Directory,
    @argument()
    npmToken: Secret,
  ): Promise<string> {
    return withTiming("publish", async () => {
      // Run CI first to ensure everything passes
      await this.ci(source);

      // Build and publish
      const container = this.installDependencies(source)
        .withExec(["bun", "run", "build"])
        .withSecretVariable("NPM_TOKEN", npmToken)
        .withExec(["sh", "-c", 'echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc && bunx npm publish']);

      return container.stdout();
    });
  }

  /**
   * Run CI and handle release logic (for main branch pushes).
   * Combines ci, release-pr, github-release, and publish into a single entry point.
   * @param source The source directory
   * @param env The environment (dev or prod)
   * @param repoUrl The repository URL (e.g., "shepherdjerred/astro-opengraph-images")
   * @param githubToken GitHub token for release-please
   * @param npmToken NPM token for publishing (only needed for prod)
   */
  @func()
  async ciWithRelease(
    @argument({ defaultPath: "." })
    source: Directory,
    env = "dev",
    repoUrl?: string,
    githubToken?: Secret,
    npmToken?: Secret,
  ): Promise<string> {
    const isProd = env === "prod";

    return withTiming("ci-with-release", async () => {
      // Always run CI first
      const ciResult = await this.ci(source);

      if (!isProd) {
        return ciResult;
      }

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

      // Try to create GitHub release (only succeeds if release PR was just merged)
      const githubReleaseResult = await withTiming("github-release", async () => {
        return sharedGithubRelease({
          ghToken: githubToken,
          repoUrl,
          releaseType: "node",
        });
      });

      // If a release was created and we have an npm token, publish
      const releaseCreated = githubReleaseResult.includes("github.com") && githubReleaseResult.includes("releases");
      if (releaseCreated && npmToken) {
        await withTiming("npm-publish", async () => {
          const container = this.installDependencies(source)
            .withExec(["bun", "run", "build"])
            .withSecretVariable("NPM_TOKEN", npmToken)
            .withExec([
              "sh",
              "-c",
              'echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc && bunx npm publish',
            ]);
          return container.stdout();
        });
        return `${ciResult}\nRelease PR: ${releasePrResult}\nGitHub Release: ${githubReleaseResult}\nPackage published to npm`;
      }

      return `${ciResult}\nRelease PR: ${releasePrResult}\nGitHub Release: ${githubReleaseResult}`;
    });
  }

  private base(source: Directory): Container {
    return dag
      .container()
      .from("oven/bun:latest")
      .withWorkdir(WORKDIR)
      .withEnvVariable("CI", "true")
      .withDirectory(WORKDIR, source, {
        // Examples are excluded because they reference the root package via "../../" which
        // creates symlinks that point back to the project root, causing infinite recursion
        // when Dagger snapshots the directory. Example tests run in GitHub Actions instead.
        exclude: ["node_modules", "examples", "**/.astro", "**/.dagger"],
      });
  }

  private installDependencies(source: Directory): Container {
    return this.base(source)
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
      .withMountedCache(`${WORKDIR}/node_modules`, dag.cacheVolume(ROOT_NODE_MODULES_CACHE))
      .withExec(["bun", "install", "--frozen-lockfile"]);
  }

  private buildRoot(source: Directory): Container {
    return this.installDependencies(source).withExec(["bun", "run", "build"]);
  }
}
