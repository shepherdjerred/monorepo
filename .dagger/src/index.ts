import { dag, object, func, Secret, Directory, Container } from "@dagger.io/dagger";
import { updateHomelabVersion } from "@shepherdjerred/dagger-utils/containers";
import {
  checkBirmel,
  buildBirmelImage,
  smokeTestBirmelImage,
  publishBirmelImage,
} from "./birmel.js";

const PACKAGES = ["eslint-config", "dagger-utils"] as const;
const REPO_URL = "shepherdjerred/monorepo";

// Inline the bun version from dagger-utils/versions.ts
const BUN_VERSION = "1.3.4";
// Pin release-please version for reproducible builds
const RELEASE_PLEASE_VERSION = "17.1.3";

// Rust version for multiplexer
const RUST_VERSION = "1.85";

/**
 * Get a Bun container with caching enabled and Playwright browsers for tests
 */
function getBunContainerWithCache(source: Directory): Container {
  return dag
    .container()
    .from(`oven/bun:${BUN_VERSION}-debian`)
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "python3"])
    .withWorkdir("/workspace")
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    .withMountedDirectory("/workspace", source)
    // Install Playwright browsers for browser automation tests
    .withExec(["bunx", "playwright", "install", "--with-deps", "chromium"]);
}

/**
 * Get a Rust container with caching enabled for multiplexer builds
 */
function getRustContainer(source: Directory): Container {
  return dag
    .container()
    .from(`rust:${RUST_VERSION}-bookworm`)
    .withWorkdir("/workspace")
    .withMountedCache("/usr/local/cargo/registry", dag.cacheVolume("cargo-registry"))
    .withMountedCache("/usr/local/cargo/git", dag.cacheVolume("cargo-git"))
    .withMountedCache("/workspace/target", dag.cacheVolume("multiplexer-target"))
    .withMountedDirectory("/workspace", source.directory("packages/multiplexer"))
    .withExec(["rustup", "component", "add", "rustfmt", "clippy"]);
}

/**
 * Get a container with release-please CLI installed (using Bun)
 */
function getReleasePleaseContainer(): Container {
  return dag
    .container()
    .from(`oven/bun:${BUN_VERSION}-debian`)
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "git"])
    .withExec(["bun", "install", "-g", `release-please@${RELEASE_PLEASE_VERSION}`])
    .withWorkdir("/workspace");
}

/**
 * Run a release-please command and capture both stdout and stderr
 */
async function runReleasePleaseCommand(
  container: Container,
  command: string
): Promise<{ output: string; success: boolean }> {
  const result = await container
    .withExec([
      "sh",
      "-c",
      // Capture both stdout and stderr, and exit code
      `${command} 2>&1; echo "EXIT_CODE:$?"`,
    ])
    .stdout();

  const lines = result.trim().split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  const exitCodeMatch = lastLine.match(/EXIT_CODE:(\d+)/);
  const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1] ?? "1", 10) : 1;
  const output = lines.slice(0, -1).join("\n");

  return {
    output: output || "(no output)",
    success: exitCode === 0,
  };
}

@object()
export class Monorepo {
  /**
   * Run the full CI/CD pipeline.
   * - Always runs: install, typecheck, test, build
   * - If githubToken and npmToken provided: also runs release-please and publishes
   * - If birmel release params provided: also runs birmel release
   */
  @func()
  async ci(
    source: Directory,
    githubToken?: Secret,
    npmToken?: Secret,
    birmelVersion?: string,
    birmelGitSha?: string,
    birmelRegistryUsername?: string,
    birmelRegistryPassword?: Secret
  ): Promise<string> {
    const outputs: string[] = [];

    // Run CI pipeline
    let container = getBunContainerWithCache(source);

    container = container.withExec(["bun", "install", "--frozen-lockfile"]);
    await container.sync();
    outputs.push("✓ Install");

    // Remove generated Prisma Client files to ensure fresh generation with current schema
    container = container.withExec(["rm", "-rf", "packages/birmel/node_modules/.prisma"]);
    await container.sync();

    // Generate Prisma Client and set up test database
    // Use bun to run prisma commands - this ensures Bun's package resolution is used
    container = container
      .withEnvVariable("DATABASE_URL", "file:./packages/birmel/data/test-ops.db")
      .withWorkdir("/workspace/packages/birmel")
      .withExec(["./node_modules/.bin/prisma", "generate"])
      .withExec(["./node_modules/.bin/prisma", "db", "push", "--accept-data-loss"])
      .withWorkdir("/workspace");
    await container.sync();
    outputs.push("✓ Prisma setup");

    container = container.withExec(["bun", "run", "typecheck"]);
    await container.sync();
    outputs.push("✓ Typecheck");

    container = container.withExec(["bun", "run", "test"]);
    await container.sync();
    outputs.push("✓ Test");

    container = container.withExec(["bun", "run", "build"]);
    await container.sync();
    outputs.push("✓ Build");

    // If tokens provided, run release workflow
    if (githubToken && npmToken) {
      outputs.push("\n--- Release Workflow ---");

      // Create/update release PRs using non-deprecated release-pr command
      const prContainer = getReleasePleaseContainer()
        .withSecretVariable("GITHUB_TOKEN", githubToken);

      const prResult = await runReleasePleaseCommand(
        prContainer,
        `git clone https://x-access-token:$GITHUB_TOKEN@github.com/${REPO_URL}.git . && release-please release-pr --token=\$GITHUB_TOKEN --repo-url=${REPO_URL} --target-branch=main`
      );

      outputs.push(`Release PR (success=${prResult.success}):`);
      outputs.push(prResult.output);

      // Create GitHub releases using non-deprecated github-release command
      const releaseContainer = getReleasePleaseContainer()
        .withSecretVariable("GITHUB_TOKEN", githubToken);

      const releaseResult = await runReleasePleaseCommand(
        releaseContainer,
        `git clone https://x-access-token:$GITHUB_TOKEN@github.com/${REPO_URL}.git . && release-please github-release --token=\$GITHUB_TOKEN --repo-url=${REPO_URL} --target-branch=main`
      );

      outputs.push(`GitHub Release (success=${releaseResult.success}):`);
      outputs.push(releaseResult.output);

      // Check if any releases were created and publish
      // Look for release URLs or "Created release" messages in the output
      const releaseCreated = releaseResult.success && (
        releaseResult.output.includes("github.com") ||
        releaseResult.output.includes("Created release") ||
        releaseResult.output.includes("created release")
      );

      if (releaseCreated) {
        outputs.push("\n--- Publishing ---");

        for (const pkg of PACKAGES) {
          try {
            await container
              .withWorkdir(`/workspace/packages/${pkg}`)
              .withSecretVariable("NPM_TOKEN", npmToken)
              .withExec(["sh", "-c", 'echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc'])
              .withExec(["bun", "publish", "--access", "public", "--tag", "latest", "--registry", "https://registry.npmjs.org"])
              .stdout();

            outputs.push(`✓ Published @shepherdjerred/${pkg}`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            outputs.push(`✗ Failed to publish @shepherdjerred/${pkg}: ${errorMessage}`);
          }
        }
      } else {
        outputs.push("No releases created - skipping publish");
        if (!releaseResult.success) {
          outputs.push("(release-please command failed - check output above for details)");
        }
      }
    }

    // Run birmel release if all params provided
    if (birmelVersion && birmelGitSha && birmelRegistryUsername && birmelRegistryPassword) {
      outputs.push("\n--- Birmel Release ---");
      const birmelResult = await this.birmelRelease(
        source,
        birmelVersion,
        birmelGitSha,
        birmelRegistryUsername,
        birmelRegistryPassword,
        githubToken
      );
      outputs.push(birmelResult);
    }

    return outputs.join("\n");
  }

  /**
   * Run Birmel CI: typecheck, lint, test
   */
  @func()
  async birmelCi(source: Directory): Promise<string> {
    await checkBirmel(source).sync();
    return "✓ Birmel CI passed (typecheck, lint, test)";
  }

  /**
   * Build Birmel Docker image
   */
  @func()
  birmelBuild(source: Directory, version: string, gitSha: string): Container {
    return buildBirmelImage(source, version, gitSha);
  }

  /**
   * Smoke test Birmel Docker image
   */
  @func()
  async birmelSmokeTest(source: Directory, version: string, gitSha: string): Promise<string> {
    return smokeTestBirmelImage(source, version, gitSha);
  }

  /**
   * Publish Birmel Docker image to ghcr.io
   */
  @func()
  async birmelPublish(
    source: Directory,
    version: string,
    gitSha: string,
    registryUsername: string,
    registryPassword: Secret,
  ): Promise<string> {
    const refs = await publishBirmelImage({
      workspaceSource: source,
      version,
      gitSha,
      registryAuth: {
        username: registryUsername,
        password: registryPassword,
      },
    });
    return `Published:\n${refs.join("\n")}`;
  }

  /**
   * Full Birmel release: CI + build + smoke test + publish + deploy to homelab
   */
  @func()
  async birmelRelease(
    source: Directory,
    version: string,
    gitSha: string,
    registryUsername: string,
    registryPassword: Secret,
    githubToken?: Secret,
  ): Promise<string> {
    const outputs: string[] = [];

    // Run CI
    outputs.push(await this.birmelCi(source));

    // Smoke test
    outputs.push(await this.birmelSmokeTest(source, version, gitSha));

    // Publish
    outputs.push(await this.birmelPublish(source, version, gitSha, registryUsername, registryPassword));

    // Deploy to homelab
    if (githubToken) {
      outputs.push(
        await updateHomelabVersion({
          ghToken: githubToken,
          appName: "birmel",
          version,
        }),
      );
    }

    return outputs.join("\n\n");
  }

  /**
   * Run Multiplexer CI: fmt check, clippy, test, build
   */
  @func()
  async multiplexerCi(source: Directory): Promise<string> {
    const outputs: string[] = [];

    let container = getRustContainer(source);

    // Format check
    container = container.withExec(["cargo", "fmt", "--check"]);
    await container.sync();
    outputs.push("✓ Format check passed");

    // Clippy with all warnings as errors
    container = container.withExec([
      "cargo", "clippy", "--all-targets", "--all-features", "--", "-D", "warnings"
    ]);
    await container.sync();
    outputs.push("✓ Clippy passed");

    // Tests
    container = container.withExec(["cargo", "test"]);
    await container.sync();
    outputs.push("✓ Tests passed");

    // Release build
    container = container.withExec(["cargo", "build", "--release"]);
    await container.sync();
    outputs.push("✓ Release build succeeded");

    return outputs.join("\n");
  }
}
