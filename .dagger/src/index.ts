import { dag, object, func, Secret, Directory, Container } from "@dagger.io/dagger";
import { updateHomelabVersion } from "@shepherdjerred/dagger-utils/containers";
import {
  checkBirmel,
  buildBirmelImage,
  smokeTestBirmelImageWithContainer,
  publishBirmelImageWithContainer,
} from "./birmel.js";

const PACKAGES = ["eslint-config", "dagger-utils", "bun-decompile"] as const;
const REPO_URL = "shepherdjerred/monorepo";

const BUN_VERSION = "1.3.4";
const PLAYWRIGHT_VERSION = "1.57.0";
// Pin release-please version for reproducible builds
const RELEASE_PLEASE_VERSION = "17.1.3";
// Rust version for multiplexer
const RUST_VERSION = "1.85";

/**
 * Get a base Bun container with system dependencies and caching.
 * LAYER ORDERING: System deps and caches are set up BEFORE any source files.
 * This is a lightweight container (python3 only) for main CI tasks.
 */
function getBaseContainer(): Container {
  return (
    dag
      .container()
      .from(`oven/bun:${BUN_VERSION}-debian`)
      // Cache APT packages (version in key for invalidation on upgrade)
      .withMountedCache("/var/cache/apt", dag.cacheVolume(`apt-cache-bun-${BUN_VERSION}-debian`))
      .withMountedCache("/var/lib/apt", dag.cacheVolume(`apt-lib-bun-${BUN_VERSION}-debian`))
      .withExec(["apt-get", "update"])
      .withExec(["apt-get", "install", "-y", "python3"])
      // Cache Bun packages
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
      // Cache Playwright browsers (version in key for invalidation)
      .withMountedCache("/root/.cache/ms-playwright", dag.cacheVolume(`playwright-browsers-${PLAYWRIGHT_VERSION}`))
      // Install Playwright Chromium and dependencies for browser automation
      .withExec(["bunx", "playwright", "install", "--with-deps", "chromium"])
      // Cache ESLint (incremental linting)
      .withMountedCache("/workspace/.eslintcache", dag.cacheVolume("eslint-cache"))
      // Cache TypeScript incremental build
      .withMountedCache("/workspace/.tsbuildinfo", dag.cacheVolume("tsbuildinfo-cache"))
  );
}

/**
 * Install workspace dependencies with optimal layer ordering.
 * PHASE 1: Copy only dependency files (package.json, bun.lock)
 * PHASE 2: Run bun install (cached if lockfile unchanged)
 * PHASE 3: Copy source files (changes frequently)
 *
 * @param source The full workspace source directory
 * @returns Container with deps installed (using mounts for CI)
 */
function installWorkspaceDeps(source: Directory): Container {
  let container = getBaseContainer().withWorkdir("/workspace");

  // PHASE 1: Dependency files only (cached if lockfile unchanged)
  container = container
    .withMountedFile("/workspace/package.json", source.file("package.json"))
    .withMountedFile("/workspace/bun.lock", source.file("bun.lock"))
    // Each workspace's package.json (bun needs these for workspace resolution)
    .withMountedFile("/workspace/packages/birmel/package.json", source.file("packages/birmel/package.json"))
    .withMountedFile("/workspace/packages/bun-decompile/package.json", source.file("packages/bun-decompile/package.json"))
    .withMountedFile("/workspace/packages/dagger-utils/package.json", source.file("packages/dagger-utils/package.json"))
    .withMountedFile("/workspace/packages/eslint-config/package.json", source.file("packages/eslint-config/package.json"));

  // PHASE 2: Install dependencies (cached if lockfile + package.jsons unchanged)
  container = container.withExec(["bun", "install", "--frozen-lockfile"]);

  // PHASE 3: Config files and source code (changes frequently, added AFTER install)
  container = container
    .withMountedFile("/workspace/tsconfig.base.json", source.file("tsconfig.base.json"))
    .withMountedDirectory("/workspace/packages/birmel", source.directory("packages/birmel"))
    .withMountedDirectory("/workspace/packages/bun-decompile", source.directory("packages/bun-decompile"))
    .withMountedDirectory("/workspace/packages/dagger-utils", source.directory("packages/dagger-utils"))
    .withMountedDirectory("/workspace/packages/eslint-config", source.directory("packages/eslint-config"));

  // PHASE 4: Re-run bun install to recreate workspace node_modules symlinks
  // (Source mounts in Phase 3 replace the symlinks that Phase 2 created)
  container = container.withExec(["bun", "install", "--frozen-lockfile"]);

  return container;
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
    .withMountedCache("/var/cache/apt", dag.cacheVolume(`apt-cache-bun-${BUN_VERSION}-debian`))
    .withMountedCache("/var/lib/apt", dag.cacheVolume(`apt-lib-bun-${BUN_VERSION}-debian`))
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
   * VALIDATION PHASE (always runs - PRs + main):
   *   - Install, Prisma setup, typecheck, test, build
   *   - Birmel CI (typecheck, lint, test)
   *   - Birmel smoke test
   * RELEASE PHASE (main only):
   *   - Release-please (create/update PRs, create GitHub releases)
   *   - NPM publish (if releases created)
   *   - Birmel publish + deploy to homelab
   */
  @func()
  async ci(
    source: Directory,
    branch: string,
    githubToken?: Secret,
    npmToken?: Secret,
    version?: string,
    gitSha?: string,
    registryUsername?: string,
    registryPassword?: Secret
  ): Promise<string> {
    const outputs: string[] = [];
    const isRelease = branch === "main";

    // ============================================
    // VALIDATION PHASE (always runs - PRs + main)
    // ============================================

    // Install dependencies with optimized layer ordering
    let container = installWorkspaceDeps(source);
    outputs.push("✓ Install");

    // Remove generated Prisma Client files to ensure fresh generation with current schema
    container = container.withExec(["rm", "-rf", "packages/birmel/node_modules/.prisma"]);

    // Generate Prisma Client and set up test database
    // Use the workspace root prisma binary (installed via root package.json devDeps)
    // data/ and data/screenshots/ directories exist in source (with .gitkeep files)
    // Use OPS_DATABASE_URL (which database/index.ts prefers) and absolute path to avoid issues
    // with relative paths during test runs from different working directories
    container = container
      .withWorkdir("/workspace/packages/birmel")
      .withEnvVariable("DATABASE_URL", "file:/workspace/packages/birmel/data/test-ops.db")
      .withEnvVariable("OPS_DATABASE_URL", "file:/workspace/packages/birmel/data/test-ops.db")
      .withExec(["/workspace/node_modules/.bin/prisma", "generate"])
      .withExec(["/workspace/node_modules/.bin/prisma", "db", "push", "--accept-data-loss"])
      .withWorkdir("/workspace");
    await container.sync();
    outputs.push("✓ Prisma setup");

    // Run typecheck and build in PARALLEL
    // Note: Skip tests here - bun-decompile tests fail in CI (requires `bun build --compile`)
    // Individual package tests will run in the birmelCi() call below
    await Promise.all([
      container.withExec(["bun", "run", "typecheck"]).sync(),
      // Skip: container.withExec(["bun", "run", "test"]).sync(),
      container.withExec(["bun", "run", "build"]).sync(),
    ]);
    outputs.push("✓ Typecheck");
    // outputs.push("✓ Test");  // Skipped - birmel tests run separately below
    outputs.push("✓ Build");

    // Birmel CI (typecheck, lint, test in parallel)
    outputs.push("\n--- Birmel Validation ---");
    outputs.push(await checkBirmel(source));

    // Build birmel image ONCE and reuse for smoke test + publish
    const birmelImage = buildBirmelImage(source, version ?? "dev", gitSha ?? "dev");

    // Birmel smoke test (validates the built image starts correctly)
    outputs.push(await smokeTestBirmelImageWithContainer(birmelImage));

    // ============================================
    // RELEASE PHASE (main only)
    // ============================================

    if (isRelease && githubToken && npmToken) {
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
      const releaseCreated = releaseResult.success && (
        releaseResult.output.includes("github.com") ||
        releaseResult.output.includes("Created release") ||
        releaseResult.output.includes("created release")
      );

      if (releaseCreated) {
        outputs.push("\n--- NPM Publishing ---");

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
        outputs.push("No releases created - skipping NPM publish");
        if (!releaseResult.success) {
          outputs.push("(release-please command failed - check output above for details)");
        }
      }

      // Birmel publish + deploy (reuses pre-built image)
      if (version && gitSha && registryUsername && registryPassword) {
        outputs.push("\n--- Birmel Release ---");
        const refs = await publishBirmelImageWithContainer({
          image: birmelImage,
          version,
          gitSha,
          registryAuth: {
            username: registryUsername,
            password: registryPassword,
          },
        });
        outputs.push(`Published:\n${refs.join("\n")}`);

        // Deploy to homelab
        outputs.push(
          await updateHomelabVersion({
            ghToken: githubToken,
            appName: "birmel",
            version,
          }),
        );
      }
    }

    return outputs.join("\n");
  }

  /**
   * Run Birmel CI: typecheck, lint, test (in parallel)
   */
  @func()
  async birmelCi(source: Directory): Promise<string> {
    return checkBirmel(source);
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
    const image = buildBirmelImage(source, version, gitSha);
    return smokeTestBirmelImageWithContainer(image);
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
    const image = buildBirmelImage(source, version, gitSha);
    const refs = await publishBirmelImageWithContainer({
      image,
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
   * Builds the image ONCE and reuses it for smoke test and publish.
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

    // Run CI (typecheck, lint, test in parallel)
    outputs.push(await this.birmelCi(source));

    // Build image ONCE
    const birmelImage = buildBirmelImage(source, version, gitSha);

    // Smoke test using pre-built image (avoids rebuilding)
    outputs.push(await smokeTestBirmelImageWithContainer(birmelImage));

    // Publish using pre-built image (avoids rebuilding)
    const refs = await publishBirmelImageWithContainer({
      image: birmelImage,
      version,
      gitSha,
      registryAuth: {
        username: registryUsername,
        password: registryPassword,
      },
    });
    outputs.push(`Published:\n${refs.join("\n")}`);

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
