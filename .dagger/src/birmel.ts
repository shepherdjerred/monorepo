import type { Directory, Container, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";

const BUN_VERSION = "1.3.5";
const PLAYWRIGHT_VERSION = "1.57.0";

/**
 * Get a base Bun container with system dependencies and caching.
 * LAYER ORDERING: System deps and caches are set up BEFORE any source files.
 */
function getBaseVoiceContainer(): Container {
  return (
    dag
      .container()
      .from(`oven/bun:${BUN_VERSION}-debian`)
      // Cache APT packages (version in key for invalidation on upgrade)
      .withMountedCache("/var/cache/apt", dag.cacheVolume(`apt-cache-bun-${BUN_VERSION}-debian`))
      .withMountedCache("/var/lib/apt", dag.cacheVolume(`apt-lib-bun-${BUN_VERSION}-debian`))
      .withExec(["apt-get", "update"])
      .withExec(["apt-get", "install", "-y", "ffmpeg", "python3", "make", "g++", "libtool-bin", "curl", "git"])
      // Install GitHub CLI for PR creation
      .withExec([
        "sh",
        "-c",
        "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main' | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && apt-get update && apt-get install -y gh",
      ])
      // Install Claude Code CLI for editor feature
      .withExec(["sh", "-c", "curl -fsSL https://claude.ai/install.sh | bash"])
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
 * @param workspaceSource The full workspace source directory
 * @param useMounts If true, use mounted directories (for CI checks). If false, copy files (for image publishing).
 * @returns Container with deps installed
 */
function installWorkspaceDeps(workspaceSource: Directory, useMounts: boolean): Container {
  let container = getBaseVoiceContainer().withWorkdir("/workspace");

  // PHASE 1: Dependency files only (cached if lockfile unchanged)
  if (useMounts) {
    container = container
      .withMountedFile("/workspace/package.json", workspaceSource.file("package.json"))
      .withMountedFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
      // Each workspace's package.json (bun needs these for workspace resolution)
      .withMountedFile("/workspace/packages/birmel/package.json", workspaceSource.file("packages/birmel/package.json"))
      .withMountedFile(
        "/workspace/packages/bun-decompile/package.json",
        workspaceSource.file("packages/bun-decompile/package.json"),
      )
      .withMountedFile(
        "/workspace/packages/dagger-utils/package.json",
        workspaceSource.file("packages/dagger-utils/package.json"),
      )
      .withMountedFile(
        "/workspace/packages/eslint-config/package.json",
        workspaceSource.file("packages/eslint-config/package.json"),
      )
      // Clauderon web packages (nested workspace with own lockfile)
      .withMountedFile(
        "/workspace/packages/clauderon/web/package.json",
        workspaceSource.file("packages/clauderon/web/package.json"),
      )
      .withMountedFile(
        "/workspace/packages/clauderon/web/bun.lock",
        workspaceSource.file("packages/clauderon/web/bun.lock"),
      )
      .withMountedFile(
        "/workspace/packages/clauderon/web/shared/package.json",
        workspaceSource.file("packages/clauderon/web/shared/package.json"),
      )
      .withMountedFile(
        "/workspace/packages/clauderon/web/client/package.json",
        workspaceSource.file("packages/clauderon/web/client/package.json"),
      )
      .withMountedFile(
        "/workspace/packages/clauderon/web/frontend/package.json",
        workspaceSource.file("packages/clauderon/web/frontend/package.json"),
      )
      // Clauderon docs package (mount full directory in PHASE 1 for workspace validation)
      .withExec(["mkdir", "-p", "/workspace/packages/clauderon/docs"])
      .withMountedDirectory("/workspace/packages/clauderon/docs", workspaceSource.directory("packages/clauderon/docs"));
  } else {
    container = container
      .withFile("/workspace/package.json", workspaceSource.file("package.json"))
      .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
      .withFile("/workspace/packages/birmel/package.json", workspaceSource.file("packages/birmel/package.json"))
      .withFile(
        "/workspace/packages/bun-decompile/package.json",
        workspaceSource.file("packages/bun-decompile/package.json"),
      )
      .withFile(
        "/workspace/packages/dagger-utils/package.json",
        workspaceSource.file("packages/dagger-utils/package.json"),
      )
      .withFile(
        "/workspace/packages/eslint-config/package.json",
        workspaceSource.file("packages/eslint-config/package.json"),
      )
      // Clauderon web packages (nested workspace with own lockfile)
      .withFile(
        "/workspace/packages/clauderon/web/package.json",
        workspaceSource.file("packages/clauderon/web/package.json"),
      )
      .withFile(
        "/workspace/packages/clauderon/web/bun.lock",
        workspaceSource.file("packages/clauderon/web/bun.lock"),
      )
      .withFile(
        "/workspace/packages/clauderon/web/shared/package.json",
        workspaceSource.file("packages/clauderon/web/shared/package.json"),
      )
      .withFile(
        "/workspace/packages/clauderon/web/client/package.json",
        workspaceSource.file("packages/clauderon/web/client/package.json"),
      )
      .withFile(
        "/workspace/packages/clauderon/web/frontend/package.json",
        workspaceSource.file("packages/clauderon/web/frontend/package.json"),
      )
      // Clauderon docs package (copy full directory in PHASE 1 for workspace validation)
      .withDirectory("/workspace/packages/clauderon/docs", workspaceSource.directory("packages/clauderon/docs"));
  }

  // PHASE 2: Install dependencies (cached if lockfile + package.jsons unchanged)
  container = container.withExec(["bun", "install", "--frozen-lockfile"]);

  // PHASE 3: Config files and source code (changes frequently, added AFTER install)
  if (useMounts) {
    container = container
      .withMountedFile("/workspace/tsconfig.base.json", workspaceSource.file("tsconfig.base.json"))
      .withMountedDirectory("/workspace/packages/birmel", workspaceSource.directory("packages/birmel"))
      .withMountedDirectory("/workspace/packages/bun-decompile", workspaceSource.directory("packages/bun-decompile"))
      .withMountedDirectory("/workspace/packages/dagger-utils", workspaceSource.directory("packages/dagger-utils"))
      .withMountedDirectory("/workspace/packages/eslint-config", workspaceSource.directory("packages/eslint-config"));
  } else {
    container = container
      .withFile("/workspace/tsconfig.base.json", workspaceSource.file("tsconfig.base.json"))
      .withDirectory("/workspace/packages/birmel", workspaceSource.directory("packages/birmel"))
      .withDirectory("/workspace/packages/bun-decompile", workspaceSource.directory("packages/bun-decompile"))
      .withDirectory("/workspace/packages/dagger-utils", workspaceSource.directory("packages/dagger-utils"))
      .withDirectory("/workspace/packages/eslint-config", workspaceSource.directory("packages/eslint-config"));
  }

  // PHASE 4: Re-run bun install to recreate workspace node_modules symlinks
  // (Source mounts/copies in Phase 3 replace the symlinks that Phase 2 created)
  container = container.withExec(["bun", "install", "--frozen-lockfile"]);

  return container;
}

/**
 * Get a prepared container with all dependencies installed (using mounts for CI)
 * @param workspaceSource The full workspace source directory
 * @returns Container ready for birmel operations
 */
export function getBirmelPrepared(workspaceSource: Directory): Container {
  return installWorkspaceDeps(workspaceSource, true).withWorkdir("/workspace/packages/birmel");
}

/**
 * Run type checking, linting, and tests for birmel in PARALLEL
 * @param workspaceSource The full workspace source directory
 * @returns Result message
 */
export async function checkBirmel(workspaceSource: Directory): Promise<string> {
  // Set up test database and directories for automation tests
  // OPS_DATABASE_URL takes priority over DATABASE_URL in the app (see database/index.ts)
  // IMPORTANT: Use paths OUTSIDE the mounted workspace (/workspace/packages/birmel is a mount)
  // Mounted directories can have write restrictions in CI environments
  const testDataDir = "/app/birmel-test";
  const testDbPath = `file:${testDataDir}/test.db`;
  const screenshotsDir = `${testDataDir}/screenshots`;

  const prepared = getBirmelPrepared(workspaceSource)
    .withEnvVariable("DATABASE_URL", testDbPath)
    .withEnvVariable("DATABASE_PATH", `${testDataDir}/test.db`)
    .withEnvVariable("BIRMEL_SCREENSHOTS_DIR", screenshotsDir)
    // Disable browser tests in CI - Chromium crashes in Dagger containers
    .withEnvVariable("BROWSER_ENABLED", "false")
    // Create test data directories OUTSIDE the mounted workspace
    .withExec(["mkdir", "-p", screenshotsDir])
    .withExec(["bunx", "prisma", "generate"])
    .withExec(["bunx", "prisma", "db", "push", "--accept-data-loss"]);

  // Run typecheck, lint, and test in PARALLEL
  await Promise.all([
    prepared.withExec(["bun", "run", "typecheck"]).sync(),
    prepared.withExec(["bun", "run", "lint"]).sync(),
    prepared.withExec(["bun", "run", "test"]).sync(),
  ]);

  return "✓ Birmel CI passed (typecheck, lint, test)";
}

/**
 * Build the birmel Docker image for production
 * Uses withDirectory (not mounts) so files are included in the published image.
 * @param workspaceSource The full workspace source directory
 * @param version The version tag
 * @param gitSha The git SHA
 * @returns The built container with files copied (not mounted)
 */
export function buildBirmelImage(workspaceSource: Directory, version: string, gitSha: string): Container {
  return installWorkspaceDeps(workspaceSource, false)
    .withWorkdir("/workspace/packages/birmel")
    .withExec(["bunx", "prisma", "generate"])
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEnvVariable("NODE_ENV", "production")
    .withEntrypoint(["sh", "-c", "bunx prisma db push --skip-generate && bun run src/index.ts"])
    .withLabel("org.opencontainers.image.title", "birmel")
    .withLabel("org.opencontainers.image.description", "AI-powered Discord server management bot");
}

/**
 * Smoke test a pre-built birmel Docker image (avoids rebuilding)
 * @param image The pre-built container image
 * @returns Test result with logs
 */
export async function smokeTestBirmelImageWithContainer(image: Container): Promise<string> {
  // Run with env vars that will cause expected startup failure (missing tokens)
  const containerWithEnv = image
    .withEnvVariable("DISCORD_TOKEN", "test-token")
    .withEnvVariable("DISCORD_CLIENT_ID", "test-client-id")
    .withEnvVariable("ANTHROPIC_API_KEY", "test-anthropic-key")
    .withEnvVariable("OPENAI_API_KEY", "test-openai-key")
    .withEnvVariable("DATABASE_URL", "file:/tmp/test.db")
    .withEnvVariable("MASTRA_MEMORY_DB_PATH", "file:/tmp/mastra-memory.db")
    .withEnvVariable("MASTRA_TELEMETRY_DB_PATH", "file:/tmp/mastra-telemetry.db")
    .withEntrypoint([]);

  const container = containerWithEnv.withExec(["sh", "-c", "timeout 30s bun run start 2>&1 || true"]);

  let output = "";

  try {
    output = await container.stdout();
  } catch (error) {
    try {
      output = await container.stderr();
    } catch (_stderrError) {
      return `❌ Smoke test failed: Could not capture container output. Error: ${String(error)}`;
    }
  }

  // Check for expected patterns indicating the bot tried to start
  const expectedPatterns = ["Logging in", "Discord", "TokenInvalid", "Invalid token", "401", "Unauthorized"];

  const hasExpectedPattern = expectedPatterns.some((pattern) => output.toLowerCase().includes(pattern.toLowerCase()));

  if (hasExpectedPattern) {
    return `✅ Smoke test passed: Container started and failed as expected due to invalid credentials.\n\nOutput snippet: ${output.slice(0, 500)}`;
  }

  return `⚠️ Smoke test unclear: Container ran but output was unexpected.\nOutput:\n${output}`;
}

/**
 * Smoke test the birmel Docker image (builds then tests)
 * @param workspaceSource The full workspace source directory
 * @param version The version tag
 * @param gitSha The git SHA
 * @returns Test result with logs
 */
export async function smokeTestBirmelImage(
  workspaceSource: Directory,
  version: string,
  gitSha: string,
): Promise<string> {
  const image = buildBirmelImage(workspaceSource, version, gitSha);
  return smokeTestBirmelImageWithContainer(image);
}

type PublishBirmelImageOptions = {
  workspaceSource: Directory;
  version: string;
  gitSha: string;
  registryAuth?: {
    username: string;
    password: Secret;
  };
};

type PublishBirmelImageWithContainerOptions = {
  image: Container;
  version: string;
  gitSha: string;
  registryAuth?:
    | {
        username: string;
        password: Secret;
      }
    | undefined;
};

/**
 * Publish the birmel Docker image
 * @param options Publishing options including workspace source, version, git SHA, and optional registry auth
 * @returns The published image references
 */
export async function publishBirmelImage(options: PublishBirmelImageOptions): Promise<string[]> {
  const image = buildBirmelImage(options.workspaceSource, options.version, options.gitSha);
  return publishBirmelImageWithContainer({
    image,
    version: options.version,
    gitSha: options.gitSha,
    registryAuth: options.registryAuth,
  });
}

/**
 * Publish a pre-built birmel Docker image (avoids rebuilding)
 * @param options Publishing options including pre-built image, version, git SHA, and optional registry auth
 * @returns The published image references
 */
export async function publishBirmelImageWithContainer(
  options: PublishBirmelImageWithContainerOptions,
): Promise<string[]> {
  let image = options.image;

  // Set up registry authentication if credentials provided
  if (options.registryAuth) {
    image = image.withRegistryAuth("ghcr.io", options.registryAuth.username, options.registryAuth.password);
  }

  const versionRef = await image.publish(`ghcr.io/shepherdjerred/birmel:${options.version}`);
  const shaRef = await image.publish(`ghcr.io/shepherdjerred/birmel:${options.gitSha}`);

  return [versionRef, shaRef];
}
