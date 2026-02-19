import type { Directory, Container } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import versions from "./lib-versions.ts";

const BUN_VERSION = versions.bun;

// ============================================================
// Base container helpers
// ============================================================

export function getBunContainer(): Container {
  return dag
    .container()
    .from(`oven/bun:${BUN_VERSION}`)
    .withWorkdir("/workspace");
}

/**
 * Install workspace dependencies with optimal caching.
 * LAYER ORDERING:
 * 1. System deps (apt) - rarely change
 * 2. Dependency files (package.json, bun.lock, patches) - change occasionally
 * 3. bun install - cached if lockfile unchanged
 * 4. Config files + source code - change frequently
 */
export function installWorkspaceDeps(
  workspaceSource: Directory,
  installOpenssl = false,
): Container {
  let container = getBunContainer();

  if (installOpenssl) {
    container = container
      .withMountedCache("/var/cache/apt", dag.cacheVolume("apt-cache"))
      .withMountedCache("/var/lib/apt/lists", dag.cacheVolume("apt-lists"))
      .withExec(["apt", "update"])
      .withExec(["apt", "install", "-y", "openssl"]);
  }

  container = container.withMountedCache(
    "/root/.bun/install/cache",
    dag.cacheVolume("bun-install-cache"),
  );
  container = container.withMountedCache(
    "/workspace/.eslintcache",
    dag.cacheVolume("scout-eslint-cache-v5"),
  );
  container = container.withMountedCache(
    "/workspace/.tsbuildinfo",
    dag.cacheVolume("tsbuildinfo-cache-v3"),
  );

  // PHASE 1: Dependency files only (for bun install caching)
  container = container
    .withWorkdir("/workspace")
    .withFile("/workspace/package.json", workspaceSource.file("package.json"))
    .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    .withDirectory("/workspace/packages/scout-for-lol/patches", workspaceSource.directory("patches"))
    .withFile(
      "/workspace/packages/backend/package.json",
      workspaceSource.file("packages/backend/package.json"),
    )
    .withFile(
      "/workspace/packages/data/package.json",
      workspaceSource.file("packages/data/package.json"),
    )
    .withFile(
      "/workspace/packages/report/package.json",
      workspaceSource.file("packages/report/package.json"),
    )
    .withFile(
      "/workspace/packages/frontend/package.json",
      workspaceSource.file("packages/frontend/package.json"),
    )
    .withFile(
      "/workspace/packages/desktop/package.json",
      workspaceSource.file("packages/desktop/package.json"),
    )
    .withFile(
      "/workspace/packages/ui/package.json",
      workspaceSource.file("packages/ui/package.json"),
    )
    .withExec(["bun", "install", "--frozen-lockfile"]);

  // PHASE 2: Config files and source code
  container = addSourceFiles(container, workspaceSource);

  // PHASE 3: Re-run bun install to recreate per-package node_modules symlinks
  // that were overwritten by withDirectory in addSourceFiles
  return container.withExec(["bun", "install", "--frozen-lockfile"]);
}

/**
 * Add config files and source code to a container (PHASE 2 of layer ordering).
 */
function addSourceFiles(
  container: Container,
  workspaceSource: Directory,
): Container {
  return container
    .withFile("/workspace/tsconfig.json", workspaceSource.file("tsconfig.json"))
    .withFile(
      "/workspace/tsconfig.base.json",
      workspaceSource.file("tsconfig.base.json"),
    )
    .withFile(
      "/workspace/eslint.config.ts",
      workspaceSource.file("eslint.config.ts"),
    )
    .withFile("/workspace/.jscpd.json", workspaceSource.file(".jscpd.json"))
    .withDirectory("/workspace/types", workspaceSource.directory("types"))
    .withDirectory("/workspace/scripts", workspaceSource.directory("scripts"))
    .withDirectory(
      "/workspace/packages/backend",
      workspaceSource.directory("packages/backend"),
    )
    .withDirectory(
      "/workspace/packages/data",
      workspaceSource.directory("packages/data"),
    )
    .withDirectory(
      "/workspace/packages/report",
      workspaceSource.directory("packages/report"),
    )
    .withDirectory(
      "/workspace/packages/frontend",
      workspaceSource.directory("packages/frontend"),
    )
    .withDirectory(
      "/workspace/packages/desktop",
      workspaceSource.directory("packages/desktop"),
    )
    .withDirectory(
      "/workspace/packages/ui",
      workspaceSource.directory("packages/ui"),
    );
}

/**
 * Generate Prisma client once and return the generated directory.
 * Expensive operation -- call once per CI run, then share.
 */
export function generatePrismaClient(workspaceSource: Directory): Directory {
  return installWorkspaceDeps(workspaceSource, true)
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "run", "generate"])
    .directory("/workspace/packages/backend/generated");
}

/**
 * Get a fully prepared workspace container with deps installed and Prisma generated.
 * Uses withDirectory (embedded files) -- works with Dagger parallelism.
 */
export function getPreparedWorkspace(
  workspaceSource: Directory,
  prismaGenerated?: Directory,
): Container {
  const base = installWorkspaceDeps(workspaceSource, true);
  if (prismaGenerated) {
    return base.withDirectory(
      "/workspace/packages/backend/generated",
      prismaGenerated,
    );
  }
  return base
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "run", "generate"])
    .withWorkdir("/workspace");
}

/**
 * Get a mounted workspace -- faster for read-only CI checks.
 */
function getMountedWorkspace(
  workspaceSource: Directory,
  installOpenssl = false,
): Container {
  let container = getBunContainer();

  if (installOpenssl) {
    container = container
      .withMountedCache("/var/cache/apt", dag.cacheVolume("apt-cache"))
      .withMountedCache("/var/lib/apt/lists", dag.cacheVolume("apt-lists"))
      .withExec(["apt", "update"])
      .withExec(["apt", "install", "-y", "openssl"]);
  }

  container = container.withMountedCache(
    "/root/.bun/install/cache",
    dag.cacheVolume("bun-install-cache"),
  );
  container = container.withMountedCache(
    "/workspace/.eslintcache",
    dag.cacheVolume("scout-eslint-cache-v5"),
  );
  container = container.withMountedCache(
    "/workspace/.tsbuildinfo",
    dag.cacheVolume("tsbuildinfo-cache-v3"),
  );

  container = container
    .withWorkdir("/workspace")
    .withMountedFile(
      "/workspace/package.json",
      workspaceSource.file("package.json"),
    )
    .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    .withMountedDirectory(
      "/workspace/packages/scout-for-lol/patches",
      workspaceSource.directory("patches"),
    )
    .withMountedFile(
      "/workspace/packages/backend/package.json",
      workspaceSource.file("packages/backend/package.json"),
    )
    .withMountedFile(
      "/workspace/packages/data/package.json",
      workspaceSource.file("packages/data/package.json"),
    )
    .withMountedFile(
      "/workspace/packages/report/package.json",
      workspaceSource.file("packages/report/package.json"),
    )
    .withMountedFile(
      "/workspace/packages/frontend/package.json",
      workspaceSource.file("packages/frontend/package.json"),
    )
    .withMountedFile(
      "/workspace/packages/desktop/package.json",
      workspaceSource.file("packages/desktop/package.json"),
    )
    .withMountedFile(
      "/workspace/packages/ui/package.json",
      workspaceSource.file("packages/ui/package.json"),
    )
    .withExec(["bun", "install", "--frozen-lockfile"]);

  container = addMountedSourceFiles(container, workspaceSource);

  // Phase 3: Re-run bun install to recreate per-package node_modules symlinks
  // that were hidden by withMountedDirectory in addMountedSourceFiles
  return container.withExec(["bun", "install", "--frozen-lockfile"]);
}

/**
 * Add mounted config files and source code to a container.
 */
function addMountedSourceFiles(
  container: Container,
  workspaceSource: Directory,
): Container {
  return container
    .withMountedFile(
      "/workspace/tsconfig.json",
      workspaceSource.file("tsconfig.json"),
    )
    .withMountedFile(
      "/workspace/tsconfig.base.json",
      workspaceSource.file("tsconfig.base.json"),
    )
    .withMountedFile(
      "/workspace/eslint.config.ts",
      workspaceSource.file("eslint.config.ts"),
    )
    .withMountedFile(
      "/workspace/.jscpd.json",
      workspaceSource.file(".jscpd.json"),
    )
    .withMountedDirectory(
      "/workspace/types",
      workspaceSource.directory("types"),
    )
    .withMountedDirectory(
      "/workspace/scripts",
      workspaceSource.directory("scripts"),
    )
    .withMountedDirectory(
      "/workspace/packages/backend",
      workspaceSource.directory("packages/backend"),
    )
    .withMountedDirectory(
      "/workspace/packages/data",
      workspaceSource.directory("packages/data"),
    )
    .withMountedDirectory(
      "/workspace/packages/report",
      workspaceSource.directory("packages/report"),
    )
    .withMountedDirectory(
      "/workspace/packages/frontend",
      workspaceSource.directory("packages/frontend"),
    )
    .withMountedDirectory(
      "/workspace/packages/desktop",
      workspaceSource.directory("packages/desktop"),
    )
    .withMountedDirectory(
      "/workspace/packages/ui",
      workspaceSource.directory("packages/ui"),
    );
}

/**
 * Get a prepared mounted workspace with Prisma generated.
 */
export function getPreparedMountedWorkspace(
  workspaceSource: Directory,
  prismaGenerated?: Directory,
): Container {
  const base = getMountedWorkspace(workspaceSource, true);
  if (prismaGenerated) {
    return base.withMountedDirectory(
      "/workspace/packages/backend/generated",
      prismaGenerated,
    );
  }
  return base
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "run", "generate"])
    .withWorkdir("/workspace");
}

// ============================================================
// Backend helpers
// ============================================================

export function getBackendPrepared(
  workspaceSource: Directory,
  preparedWorkspace?: Container,
): Container {
  const base = preparedWorkspace ?? getPreparedWorkspace(workspaceSource);
  return base.withWorkdir("/workspace/packages/backend");
}

export function buildBackendImage(
  workspaceSource: Directory,
  version: string,
  gitSha: string,
  preparedWorkspace?: Container,
): Container {
  return getBackendPrepared(workspaceSource, preparedWorkspace)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEntrypoint([
      "sh",
      "-c",
      "bun run src/database/migrate.ts && bun run src/index.ts",
    ])
    .withLabel("org.opencontainers.image.title", "scout-for-lol-backend")
    .withLabel(
      "org.opencontainers.image.description",
      "Scout for LoL Discord bot backend",
    )
    .withLabel("healthcheck.command", "bun run src/health.ts")
    .withLabel("healthcheck.interval", "30s")
    .withLabel("healthcheck.timeout", "10s")
    .withLabel("healthcheck.retries", "3")
    .withLabel("org.opencontainers.image.source", "https://github.com/shepherdjerred/monorepo");
}

export async function smokeTestBackendImageWithContainer(
  image: Container,
  workspaceSource: Directory,
): Promise<string> {
  const testDbName = `test-${Date.now().toString()}.sqlite`;

  const containerWithEnv = image
    .withFile(
      ".env",
      workspaceSource.directory("packages/backend").file("example.env"),
    )
    .withEnvVariable("DATABASE_URL", `file:./${testDbName}`)
    .withEntrypoint([]);

  const container = containerWithEnv.withExec([
    "sh",
    "-c",
    "timeout 60s bun run src/database/migrate.ts && timeout 60s bun run src/index.ts 2>&1 || true",
  ]);

  let output = "";
  try {
    output = await container.stdout();
  } catch (error) {
    try {
      output = await container.stderr();
    } catch {
      return `Smoke test failed: Could not capture container output. Error: ${String(error)}`;
    }
  }

  return evaluateSmokeTestOutput(output);
}

/**
 * Evaluate the smoke test output against expected patterns.
 */
function evaluateSmokeTestOutput(output: string): string {
  const expectedSuccessPatterns = [
    "All migrations have been successfully applied",
    "Starting registration of",
    "Logging into Discord",
  ];
  const expectedFailurePatterns = [
    "401: Unauthorized",
    "An invalid token was provided",
    "TokenInvalid",
  ];

  const hasExpectedSuccess = expectedSuccessPatterns.some((pattern) =>
    output.includes(pattern),
  );
  const hasExpectedFailure = expectedFailurePatterns.some((pattern) =>
    output.includes(pattern),
  );

  if (hasExpectedSuccess && hasExpectedFailure) {
    return "Smoke test passed: Container started successfully and failed as expected due to auth issues.";
  } else if (hasExpectedSuccess && !hasExpectedFailure) {
    return `Smoke test partial: Container started successfully but didn't fail as expected.\nOutput:\n${output}`;
  } else {
    return `Smoke test failed: Container behavior doesn't match expectations.\nOutput:\n${output}`;
  }
}

// ============================================================
// Frontend helpers
// ============================================================

export function buildFrontend(
  workspaceSource: Directory,
  preparedWorkspace?: Container,
): Directory {
  const base = preparedWorkspace ?? getPreparedWorkspace(workspaceSource);
  const container = base
    .withWorkdir("/workspace/packages/frontend")
    .withExec(["bun", "run", "build"]);
  return container.directory("/workspace/packages/frontend/dist");
}

