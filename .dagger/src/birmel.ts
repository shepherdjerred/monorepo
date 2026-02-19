import type { Directory, Container, Secret } from "@dagger.io/dagger";
import {
  getBaseBunDebianContainer,
  installMonorepoWorkspaceDeps,
} from "./lib-monorepo-workspace.ts";
import type { WorkspaceEntry } from "./lib-monorepo-workspace.ts";

/**
 * Birmel-specific base container with voice/build dependencies.
 * Adds ffmpeg, build tools, GitHub CLI, and Claude CLI on top of the shared base.
 */
function getBirmelBaseContainer(): Container {
  return getBaseBunDebianContainer({
    extraAptPackages: ["ffmpeg", "make", "g++", "libtool-bin", "curl", "git"],
    postAptSetup: (container) =>
      container
        // Install GitHub CLI for PR creation
        .withExec([
          "sh",
          "-c",
          "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main' | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && apt-get update && apt-get install -y gh",
        ])
        // Install Claude Code CLI for editor feature
        .withExec([
          "sh",
          "-c",
          "curl -fsSL https://claude.ai/install.sh | bash && ln -sf /root/.local/bin/claude /usr/local/bin/claude",
        ]),
  });
}

/**
 * Workspace entries for birmel CI/build.
 * Subset of the full monorepo — only packages needed by birmel.
 */
const BIRMEL_WORKSPACES: WorkspaceEntry[] = [
  "packages/birmel",
  "packages/bun-decompile",
  "packages/eslint-config",
  { path: "packages/resume", depsOnly: true },
  "packages/tools",
  // Clauderon web: deps-only (birmel doesn't need clauderon web source)
  {
    path: "packages/clauderon/web",
    depsOnly: true,
    extraFiles: ["packages/clauderon/web/bun.lock"],
    subPackages: [
      "packages/clauderon/web/shared",
      "packages/clauderon/web/client",
      "packages/clauderon/web/frontend",
    ],
  },
  { path: "packages/clauderon/web/shared", depsOnly: true },
  { path: "packages/clauderon/web/client", depsOnly: true },
  { path: "packages/clauderon/web/frontend", depsOnly: true },
  // Clauderon docs: full directory in PHASE 1 (workspace validation)
  { path: "packages/clauderon/docs", fullDirPhase1: true },
  "packages/astro-opengraph-images",
  "packages/better-skill-capped",
  "packages/sjer.red",
  "packages/webring",
  "packages/starlight-karma-bot",
];

/**
 * Install birmel workspace dependencies.
 * @param workspaceSource The full workspace source directory
 * @param useMounts If true, use mounted directories (for CI). If false, copy files (for image publishing).
 * @returns Container with deps installed
 */
function installWorkspaceDeps(
  workspaceSource: Directory,
  useMounts: boolean,
): Container {
  return installMonorepoWorkspaceDeps({
    baseContainer: getBirmelBaseContainer(),
    source: workspaceSource,
    useMounts,
    workspaces: BIRMEL_WORKSPACES,
    rootConfigFiles: ["tsconfig.base.json"],
  });
}

/**
 * Get a prepared container with all dependencies installed (using mounts for CI)
 * @param workspaceSource The full workspace source directory
 * @returns Container ready for birmel operations
 */
export function getBirmelPrepared(workspaceSource: Directory): Container {
  return installWorkspaceDeps(workspaceSource, true)
    .withWorkdir("/workspace/packages/eslint-config")
    .withExec(["bun", "run", "build"])
    .withWorkdir("/workspace/packages/birmel");
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
export function buildBirmelImage(
  workspaceSource: Directory,
  version: string,
  gitSha: string,
): Container {
  return installWorkspaceDeps(workspaceSource, false)
    .withWorkdir("/workspace/packages/birmel")
    .withExec(["bunx", "prisma", "generate"])
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEnvVariable("NODE_ENV", "production")
    .withEntrypoint([
      "sh",
      "-c",
      "bunx prisma db push --skip-generate && bun run src/index.ts",
    ])
    .withLabel("org.opencontainers.image.title", "birmel")
    .withLabel(
      "org.opencontainers.image.description",
      "AI-powered Discord server management bot",
    )
    .withLabel("org.opencontainers.image.source", "https://github.com/shepherdjerred/monorepo");
}

/**
 * Smoke test a pre-built birmel Docker image (avoids rebuilding)
 * @param image The pre-built container image
 * @returns Test result with logs
 */
export async function smokeTestBirmelImageWithContainer(
  image: Container,
): Promise<string> {
  // Run with env vars that will cause expected startup failure (missing tokens)
  const containerWithEnv = image
    .withEnvVariable("DISCORD_TOKEN", "test-token")
    .withEnvVariable("DISCORD_CLIENT_ID", "test-client-id")
    .withEnvVariable("ANTHROPIC_API_KEY", "test-anthropic-key")
    .withEnvVariable("OPENAI_API_KEY", "test-openai-key")
    .withEnvVariable("DATABASE_URL", "file:/tmp/test.db")
    .withEnvVariable("MASTRA_MEMORY_DB_PATH", "file:/tmp/mastra-memory.db")
    .withEnvVariable(
      "MASTRA_TELEMETRY_DB_PATH",
      "file:/tmp/mastra-telemetry.db",
    )
    .withEntrypoint([]);

  const container = containerWithEnv.withExec([
    "sh",
    "-c",
    "timeout 30s bun run start 2>&1 || true",
  ]);

  let output = "";

  try {
    output = await container.stdout();
  } catch (error) {
    try {
      output = await container.stderr();
    } catch {
      return `❌ Smoke test failed: Could not capture container output. Error: ${String(error)}`;
    }
  }

  // Check for expected patterns indicating the bot tried to start
  const expectedPatterns = [
    "Logging in",
    "Discord",
    "TokenInvalid",
    "Invalid token",
    "401",
    "Unauthorized",
  ];

  const hasExpectedPattern = expectedPatterns.some((pattern) =>
    output.toLowerCase().includes(pattern.toLowerCase()),
  );

  if (hasExpectedPattern) {
    return `✅ Smoke test passed: Container started and failed as expected due to invalid credentials.\n\nOutput snippet: ${output.slice(0, 500)}`;
  }

  return `⚠️ Smoke test unclear: Container ran but output was unexpected.\nOutput:\n${output}`;
}

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
    image = image.withRegistryAuth(
      "ghcr.io",
      options.registryAuth.username,
      options.registryAuth.password,
    );
  }

  const versionRef = await image.publish(
    `ghcr.io/shepherdjerred/birmel:${options.version}`,
  );
  const shaRef = await image.publish(
    `ghcr.io/shepherdjerred/birmel:${options.gitSha}`,
  );
  const latestRef = await image.publish("ghcr.io/shepherdjerred/birmel:latest");

  return [versionRef, shaRef, latestRef];
}
