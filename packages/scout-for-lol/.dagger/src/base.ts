import type { Container, Directory } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { getGitHubContainer } from "@shepherdjerred/dagger-utils/containers";

const BUN_VERSION = "1.3.9";

/**
 * Get a base Bun container
 * @returns A Bun container with basic setup
 */
export function getBunContainer(): Container {
  return dag.container().from(`oven/bun:${BUN_VERSION}`).withWorkdir("/workspace");
}

/**
 * Generate Prisma client once and return the generated directory.
 * This is expensive and should only be called once per CI run, then shared.
 * @param workspaceSource The full workspace source directory
 * @returns The generated Prisma client directory
 */
export function generatePrismaClient(workspaceSource: Directory): Directory {
  return installWorkspaceDeps(workspaceSource, true)
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "run", "generate"])
    .directory("/workspace/packages/backend/generated");
}

/**
 * Get a fully prepared workspace container with all dependencies installed and Prisma generated.
 * This is the optimized base container for running CI checks - call it once and share across all checks.
 * @param workspaceSource The full workspace source directory
 * @param prismaGenerated Optional pre-generated Prisma client directory (avoids re-generating)
 * @returns Container with deps installed and Prisma client generated
 */
export function getPreparedWorkspace(workspaceSource: Directory, prismaGenerated?: Directory): Container {
  const base = installWorkspaceDeps(workspaceSource, true);

  if (prismaGenerated) {
    // Use pre-generated Prisma client
    return base.withDirectory("/workspace/packages/backend/generated", prismaGenerated);
  }

  // Generate Prisma client (fallback for standalone usage)
  return base.withWorkdir("/workspace/packages/backend").withExec(["bun", "run", "generate"]).withWorkdir("/workspace");
}

/**
 * Install workspace dependencies with optimal caching
 * This function is shared across all packages to maximize cache reuse
 *
 * LAYER ORDERING FOR CACHING:
 * 1. System deps (apt) - rarely change
 * 2. Dependency files (package.json, bun.lock, patches) - change occasionally
 * 3. bun install - cached if lockfile unchanged
 * 4. Config files + source code - change frequently
 *
 * This ordering ensures bun install is cached even when only source code changes.
 *
 * @param workspaceSource The full workspace source directory
 * @param installOpenssl Whether to install OpenSSL (required for backend/Prisma)
 * @returns The container with all workspace dependencies installed
 */
export function installWorkspaceDeps(workspaceSource: Directory, installOpenssl = false): Container {
  let container = getBunContainer();

  // Install system dependencies if needed (with APT cache for faster subsequent runs)
  if (installOpenssl) {
    container = container
      .withMountedCache("/var/cache/apt", dag.cacheVolume("apt-cache"))
      .withMountedCache("/var/lib/apt/lists", dag.cacheVolume("apt-lists"))
      .withExec(["apt", "update"])
      .withExec(["apt", "install", "-y", "openssl"]);
  }

  // Mount Bun install cache (persists across runs)
  container = container.withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-install-cache"));

  // Mount ESLint cache for faster incremental linting (uses content-based hashing)
  container = container.withMountedCache("/workspace/.eslintcache", dag.cacheVolume("eslint-cache"));

  // Mount TypeScript incremental build cache
  container = container.withMountedCache("/workspace/.tsbuildinfo", dag.cacheVolume("tsbuildinfo-cache"));

  // PHASE 1: Dependency files only (for bun install caching)
  // Only add files needed for bun install - this layer is cached if lockfile unchanged
  container = container
    .withWorkdir("/workspace")
    // Root dependency files
    .withFile("/workspace/package.json", workspaceSource.file("package.json"))
    .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    // Patches directory (needed for bun patch to work during install)
    .withDirectory("/workspace/patches", workspaceSource.directory("patches"))
    // Each workspace's package.json (bun needs these for workspace resolution)
    .withFile("/workspace/packages/backend/package.json", workspaceSource.file("packages/backend/package.json"))
    .withFile("/workspace/packages/data/package.json", workspaceSource.file("packages/data/package.json"))
    .withFile("/workspace/packages/report/package.json", workspaceSource.file("packages/report/package.json"))
    .withFile("/workspace/packages/frontend/package.json", workspaceSource.file("packages/frontend/package.json"))
    .withFile("/workspace/packages/desktop/package.json", workspaceSource.file("packages/desktop/package.json"))
    .withFile("/workspace/packages/ui/package.json", workspaceSource.file("packages/ui/package.json"))
    // Install dependencies (cached if lockfile + package.jsons unchanged)
    .withExec(["bun", "install", "--frozen-lockfile"]);

  // PHASE 2: Config files and source code (changes frequently)
  // Added AFTER bun install so source changes don't invalidate install cache
  return (
    container
      // Config files
      .withFile("/workspace/tsconfig.json", workspaceSource.file("tsconfig.json"))
      .withFile("/workspace/tsconfig.base.json", workspaceSource.file("tsconfig.base.json"))
      .withFile("/workspace/eslint.config.ts", workspaceSource.file("eslint.config.ts"))
      .withFile("/workspace/.jscpd.json", workspaceSource.file(".jscpd.json"))
      .withDirectory("/workspace/eslint-rules", workspaceSource.directory("eslint-rules"))
      // Type declarations (needed for ?raw imports, etc.)
      .withDirectory("/workspace/types", workspaceSource.directory("types"))
      // Scripts directory (for utility scripts)
      .withDirectory("/workspace/scripts", workspaceSource.directory("scripts"))
      // Package source code (changes frequently)
      .withDirectory("/workspace/packages/backend", workspaceSource.directory("packages/backend"))
      .withDirectory("/workspace/packages/data", workspaceSource.directory("packages/data"))
      .withDirectory("/workspace/packages/report", workspaceSource.directory("packages/report"))
      .withDirectory("/workspace/packages/frontend", workspaceSource.directory("packages/frontend"))
      .withDirectory("/workspace/packages/desktop", workspaceSource.directory("packages/desktop"))
      .withDirectory("/workspace/packages/ui", workspaceSource.directory("packages/ui"))
  );
}

/**
 * Get a workspace container using mounts instead of copies.
 * More performant for read-only CI checks (typecheck, lint, test) since mounts are faster.
 * Note: Files mounted this way are NOT included in the final container image.
 * Use installWorkspaceDeps() instead if you need files in the publishable image (e.g., backend Docker image).
 *
 * LAYER ORDERING FOR CACHING:
 * 1. System deps (apt) - rarely change
 * 2. Dependency files (package.json, bun.lock, patches) - change occasionally
 * 3. bun install - cached if lockfile unchanged
 * 4. Config files + source code - change frequently
 *
 * @param workspaceSource The full workspace source directory
 * @param installOpenssl Whether to install OpenSSL (required for backend/Prisma)
 * @returns Container with deps installed using mounts for better performance
 */
export function getMountedWorkspace(workspaceSource: Directory, installOpenssl = false): Container {
  let container = getBunContainer();

  // Install system dependencies if needed (with APT cache for faster subsequent runs)
  if (installOpenssl) {
    container = container
      .withMountedCache("/var/cache/apt", dag.cacheVolume("apt-cache"))
      .withMountedCache("/var/lib/apt/lists", dag.cacheVolume("apt-lists"))
      .withExec(["apt", "update"])
      .withExec(["apt", "install", "-y", "openssl"]);
  }

  // Mount Bun install cache (persists across runs)
  container = container.withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-install-cache"));

  // Mount ESLint cache for faster incremental linting (uses content-based hashing)
  container = container.withMountedCache("/workspace/.eslintcache", dag.cacheVolume("eslint-cache"));

  // Mount TypeScript incremental build cache
  container = container.withMountedCache("/workspace/.tsbuildinfo", dag.cacheVolume("tsbuildinfo-cache"));

  // PHASE 1: Dependency files only (for bun install caching)
  container = container
    .withWorkdir("/workspace")
    // Root dependency files
    .withMountedFile("/workspace/package.json", workspaceSource.file("package.json"))
    .withMountedFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    // Patches directory (needed for bun patch to work during install)
    .withMountedDirectory("/workspace/patches", workspaceSource.directory("patches"))
    // Each workspace's package.json (bun needs these for workspace resolution)
    .withMountedFile("/workspace/packages/backend/package.json", workspaceSource.file("packages/backend/package.json"))
    .withMountedFile("/workspace/packages/data/package.json", workspaceSource.file("packages/data/package.json"))
    .withMountedFile("/workspace/packages/report/package.json", workspaceSource.file("packages/report/package.json"))
    .withMountedFile(
      "/workspace/packages/frontend/package.json",
      workspaceSource.file("packages/frontend/package.json"),
    )
    .withMountedFile("/workspace/packages/desktop/package.json", workspaceSource.file("packages/desktop/package.json"))
    .withMountedFile("/workspace/packages/ui/package.json", workspaceSource.file("packages/ui/package.json"))
    // Install dependencies (cached if lockfile + package.jsons unchanged)
    .withExec(["bun", "install", "--frozen-lockfile"]);

  // PHASE 2: Config files and source code (changes frequently)
  return (
    container
      // Config files
      .withMountedFile("/workspace/tsconfig.json", workspaceSource.file("tsconfig.json"))
      .withMountedFile("/workspace/tsconfig.base.json", workspaceSource.file("tsconfig.base.json"))
      .withMountedFile("/workspace/eslint.config.ts", workspaceSource.file("eslint.config.ts"))
      .withMountedFile("/workspace/.jscpd.json", workspaceSource.file(".jscpd.json"))
      .withMountedDirectory("/workspace/eslint-rules", workspaceSource.directory("eslint-rules"))
      // Type declarations (needed for ?raw imports, etc.)
      .withMountedDirectory("/workspace/types", workspaceSource.directory("types"))
      // Scripts directory (for utility scripts)
      .withMountedDirectory("/workspace/scripts", workspaceSource.directory("scripts"))
      // Package source code (changes frequently)
      .withMountedDirectory("/workspace/packages/backend", workspaceSource.directory("packages/backend"))
      .withMountedDirectory("/workspace/packages/data", workspaceSource.directory("packages/data"))
      .withMountedDirectory("/workspace/packages/report", workspaceSource.directory("packages/report"))
      .withMountedDirectory("/workspace/packages/frontend", workspaceSource.directory("packages/frontend"))
      .withMountedDirectory("/workspace/packages/desktop", workspaceSource.directory("packages/desktop"))
      .withMountedDirectory("/workspace/packages/ui", workspaceSource.directory("packages/ui"))
  );
}

/**
 * Get a fully prepared workspace container using mounts, with Prisma generated.
 * More performant for CI checks than getPreparedWorkspace() since it uses mounts.
 * @param workspaceSource The full workspace source directory
 * @param prismaGenerated Optional pre-generated Prisma client directory (avoids re-generating)
 * @returns Container with deps installed and Prisma client generated
 */
export function getPreparedMountedWorkspace(workspaceSource: Directory, prismaGenerated?: Directory): Container {
  const base = getMountedWorkspace(workspaceSource, true);

  if (prismaGenerated) {
    // Use pre-generated Prisma client (mount it since this is a mounted workspace)
    return base.withMountedDirectory("/workspace/packages/backend/generated", prismaGenerated);
  }

  // Generate Prisma client (fallback for standalone usage)
  return base.withWorkdir("/workspace/packages/backend").withExec(["bun", "run", "generate"]).withWorkdir("/workspace");
}

/**
 * Get a Bun container with Node.js support (cached)
 * @param workspaceSource Optional workspace source directory to mount
 * @returns A Bun container with Node.js installed
 */
export function getBunNodeContainer(workspaceSource?: Directory): Container {
  // Cache the apt packages to speed up Node.js installation
  let container = dag
    .container()
    .from(`oven/bun:${BUN_VERSION}`)
    .withWorkdir("/workspace")
    .withMountedCache("/var/cache/apt", dag.cacheVolume("apt-cache"))
    .withMountedCache("/var/lib/apt/lists", dag.cacheVolume("apt-lists"))
    .withExec(["apt", "update"])
    .withExec(["apt", "install", "-y", "curl", "ca-certificates", "gnupg"])
    .withExec(["mkdir", "-p", "/etc/apt/keyrings"])
    .withExec([
      "sh",
      "-c",
      "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg",
    ])
    .withExec([
      "sh",
      "-c",
      'echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list',
    ])
    .withExec(["apt", "update"])
    .withExec(["apt", "install", "-y", "nodejs"])
    .withExec(["npm", "install", "-g", "npm"]);

  // If workspace source is provided, mount it
  if (workspaceSource) {
    container = container
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-install-cache"))
      .withFile("/workspace/tsconfig.json", workspaceSource.file("tsconfig.json"))
      .withFile("/workspace/tsconfig.base.json", workspaceSource.file("tsconfig.base.json"))
      .withFile("/workspace/eslint.config.ts", workspaceSource.file("eslint.config.ts"))
      .withFile("/workspace/.jscpd.json", workspaceSource.file(".jscpd.json"))
      .withDirectory("/workspace/eslint-rules", workspaceSource.directory("eslint-rules"))
      .withDirectory("/workspace/types", workspaceSource.directory("types"))
      .withFile("/workspace/package.json", workspaceSource.file("package.json"))
      .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
      .withDirectory("/workspace/patches", workspaceSource.directory("patches"))
      .withDirectory("/workspace/scripts", workspaceSource.directory("scripts"))
      .withDirectory("/workspace/packages/backend", workspaceSource.directory("packages/backend"))
      .withDirectory("/workspace/packages/data", workspaceSource.directory("packages/data"))
      .withDirectory("/workspace/packages/report", workspaceSource.directory("packages/report"))
      .withDirectory("/workspace/packages/frontend", workspaceSource.directory("packages/frontend"))
      .withDirectory("/workspace/packages/desktop", workspaceSource.directory("packages/desktop"))
      .withDirectory("/workspace/packages/ui", workspaceSource.directory("packages/ui"));
  }

  return container;
}

// Re-export getGitHubContainer from dagger-utils for convenience
export { getGitHubContainer };
