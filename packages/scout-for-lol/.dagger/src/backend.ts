import type { Directory, Container, Secret } from "@dagger.io/dagger";
import { installWorkspaceDeps, getBunContainer, getPreparedWorkspace } from "@scout-for-lol/.dagger/src/base";

/**
 * Install dependencies for the backend
 * @param workspaceSource The full workspace source directory
 * @returns The container with dependencies installed
 */
export function installBackendDeps(workspaceSource: Directory): Container {
  // Backend needs OpenSSL for Prisma
  return installWorkspaceDeps(workspaceSource, true);
}

/**
 * Get a prepared container for backend with deps and Prisma generated
 * @param workspaceSource The full workspace source directory
 * @param preparedWorkspace Optional pre-prepared container to reuse (avoids re-installing deps)
 * @returns Container ready for backend operations
 */
export function getBackendPrepared(workspaceSource: Directory, preparedWorkspace?: Container): Container {
  const base = preparedWorkspace ?? getPreparedWorkspace(workspaceSource);
  return base.withWorkdir("/workspace/packages/backend");
}

/**
 * Update the Bun lockfile
 * @param source The source directory
 * @returns The updated lockfile
 */
export function updateLockfile(source: Directory): Directory {
  return getBunContainer()
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "install"])
    .directory("/workspace/packages/backend");
}

/**
 * Run type checking, linting, and tests for the backend
 * @param workspaceSource The full workspace source directory
 * @param preparedWorkspace Optional pre-prepared container (with deps+Prisma already done)
 * @returns The test results
 */
export function checkBackend(workspaceSource: Directory, preparedWorkspace?: Container): Container {
  return getBackendPrepared(workspaceSource, preparedWorkspace)
    .withExec(["bun", "run", "typecheck"])
    .withExec(["bun", "run", "lint"])
    .withExec(["bun", "run", "test:ci"]);
}

/**
 * Export test coverage for the backend
 * @param workspaceSource The full workspace source directory
 * @returns The coverage directory
 */
export function getBackendCoverage(workspaceSource: Directory): Directory {
  return checkBackend(workspaceSource).directory("/workspace/packages/backend/coverage");
}

/**
 * Export test report for the backend
 * @param workspaceSource The full workspace source directory
 * @returns The test report file
 */
export function getBackendTestReport(workspaceSource: Directory): Directory {
  return checkBackend(workspaceSource).directory("/workspace/packages/backend");
}

/**
 * Build the backend Docker image
 * @param workspaceSource The full workspace source directory
 * @param version The version tag
 * @param gitSha The git SHA
 * @param preparedWorkspace Optional pre-prepared container (with deps+Prisma already done)
 * @returns The built container
 */
export function buildBackendImage(
  workspaceSource: Directory,
  version: string,
  gitSha: string,
  preparedWorkspace?: Container,
): Container {
  // Health check available via: bun run src/health.ts
  // This should be configured in K8s manifests as a liveness/readiness probe
  return getBackendPrepared(workspaceSource, preparedWorkspace)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEntrypoint(["sh", "-c", "bun run src/database/migrate.ts && bun run src/index.ts"])
    .withLabel("org.opencontainers.image.title", "scout-for-lol-backend")
    .withLabel("org.opencontainers.image.description", "Scout for LoL Discord bot backend")
    .withLabel("healthcheck.command", "bun run src/health.ts")
    .withLabel("healthcheck.interval", "30s")
    .withLabel("healthcheck.timeout", "10s")
    .withLabel("healthcheck.retries", "3");
}

/**
 * Smoke test the backend Docker image
 * @param workspaceSource The full workspace source directory
 * @param version The version tag
 * @param gitSha The git SHA
 * @returns Test result with logs
 */
export async function smokeTestBackendImage(
  workspaceSource: Directory,
  version: string,
  gitSha: string,
): Promise<string> {
  const image = buildBackendImage(workspaceSource, version, gitSha);
  return smokeTestBackendImageWithContainer(image, workspaceSource);
}

/**
 * Smoke test a pre-built backend Docker image (avoids rebuilding)
 * @param image The pre-built container image
 * @param workspaceSource The full workspace source directory (for example.env)
 * @returns Test result with logs
 */
export async function smokeTestBackendImageWithContainer(
  image: Container,
  workspaceSource: Directory,
): Promise<string> {
  // Use a unique database name for this test run to avoid caching issues
  const testDbName = `test-${Date.now().toString()}.sqlite`;

  // Copy example.env to .env and override DATABASE_URL for clean test
  const containerWithEnv = image
    .withFile(".env", workspaceSource.directory("packages/backend").file("example.env"))
    .withEnvVariable("DATABASE_URL", `file:./${testDbName}`)
    .withEntrypoint([]); // Clear the entrypoint so we can run our own commands

  // Run the container with a timeout and capture output using combined stdout/stderr
  // Increased timeout to 60s to account for dependency installation at runtime
  const container = containerWithEnv.withExec([
    "sh",
    "-c",
    "timeout 60s bun run src/database/migrate.ts && timeout 60s bun run src/index.ts 2>&1 || true",
  ]);

  let output = "";

  try {
    output = await container.stdout();
  } catch (error) {
    // Try to get stderr if stdout fails
    try {
      output = await container.stderr();
    } catch (_stderrError) {
      return `❌ Smoke test failed: Could not capture container output. Error: ${String(error)}`;
    }
  }

  // Check for expected success patterns
  const expectedSuccessPatterns = [
    "All migrations have been successfully applied",
    "Starting registration of",
    "Logging into Discord",
  ];

  const expectedFailurePatterns = ["401: Unauthorized", "An invalid token was provided", "TokenInvalid"];

  const hasExpectedSuccess = expectedSuccessPatterns.some((pattern) => output.includes(pattern));

  const hasExpectedFailure = expectedFailurePatterns.some((pattern) => output.includes(pattern));

  if (hasExpectedSuccess && hasExpectedFailure) {
    const foundSuccess = expectedSuccessPatterns.filter((p) => output.includes(p));
    const foundFailure = expectedFailurePatterns.filter((p) => output.includes(p));

    return `✅ Smoke test passed: Container started successfully and failed as expected due to auth issues.\n\nKey success indicators found:\n${foundSuccess.map((p) => `- ${p}`).join("\n")}\n\nExpected failures found:\n${foundFailure.map((p) => `- ${p}`).join("\n")}`;
  } else if (hasExpectedSuccess && !hasExpectedFailure) {
    return `⚠️ Smoke test partial: Container started successfully but didn't fail as expected.\nOutput:\n${output}`;
  } else if (!hasExpectedSuccess && hasExpectedFailure) {
    return `❌ Smoke test failed: Container failed but didn't show expected startup success.\nOutput:\n${output}`;
  } else {
    return `❌ Smoke test failed: Container behavior doesn't match expectations.\nOutput:\n${output}`;
  }
}

type PublishBackendImageOptions = {
  workspaceSource: Directory;
  version: string;
  gitSha: string;
  registryAuth?: {
    username: string;
    password: Secret;
  };
};

type PublishBackendImageWithContainerOptions = {
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
 * Publish the backend Docker image
 * @param options Publishing options including workspace source, version, git SHA, and optional registry auth
 * @returns The published image references
 */
export async function publishBackendImage(options: PublishBackendImageOptions): Promise<string[]> {
  const image = buildBackendImage(options.workspaceSource, options.version, options.gitSha);
  return publishBackendImageWithContainer({
    image,
    version: options.version,
    gitSha: options.gitSha,
    registryAuth: options.registryAuth,
  });
}

/**
 * Publish a pre-built backend Docker image (avoids rebuilding)
 * @param options Publishing options including pre-built image, version, git SHA, and optional registry auth
 * @returns The published image references
 */
export async function publishBackendImageWithContainer(
  options: PublishBackendImageWithContainerOptions,
): Promise<string[]> {
  let image = options.image;

  // Set up registry authentication if credentials provided
  if (options.registryAuth) {
    image = image.withRegistryAuth("ghcr.io", options.registryAuth.username, options.registryAuth.password);
  }

  const versionRef = await image.publish(`ghcr.io/shepherdjerred/scout-for-lol:${options.version}`);
  const shaRef = await image.publish(`ghcr.io/shepherdjerred/scout-for-lol:${options.gitSha}`);

  return [versionRef, shaRef];
}
