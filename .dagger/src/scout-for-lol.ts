import type { Directory, Container, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import {
  syncToS3,
  publishToGhcrMultiple,
  updateHomelabVersion,
  getGitHubContainer,
} from "./lib/containers/index.js";
import { logWithTimestamp, withTiming } from "./lib/index.js";

const BUN_VERSION = "1.3.9";

// ============================================================
// Base container helpers (from base.ts)
// ============================================================

function getBunContainer(): Container {
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
function installWorkspaceDeps(
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
    dag.cacheVolume("eslint-cache"),
  );
  container = container.withMountedCache(
    "/workspace/.tsbuildinfo",
    dag.cacheVolume("tsbuildinfo-cache"),
  );

  // PHASE 1: Dependency files only (for bun install caching)
  container = container
    .withWorkdir("/workspace")
    .withFile("/workspace/package.json", workspaceSource.file("package.json"))
    .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    .withDirectory("/workspace/patches", workspaceSource.directory("patches"))
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
    .withDirectory(
      "/workspace/eslint-rules",
      workspaceSource.directory("eslint-rules"),
    )
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
function generatePrismaClient(workspaceSource: Directory): Directory {
  return installWorkspaceDeps(workspaceSource, true)
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "run", "generate"])
    .directory("/workspace/packages/backend/generated");
}

/**
 * Get a fully prepared workspace container with deps installed and Prisma generated.
 * Uses withDirectory (embedded files) -- works with Dagger parallelism.
 */
function getPreparedWorkspace(
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
    dag.cacheVolume("eslint-cache"),
  );
  container = container.withMountedCache(
    "/workspace/.tsbuildinfo",
    dag.cacheVolume("tsbuildinfo-cache"),
  );

  container = container
    .withWorkdir("/workspace")
    .withMountedFile(
      "/workspace/package.json",
      workspaceSource.file("package.json"),
    )
    .withMountedFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    .withMountedDirectory(
      "/workspace/patches",
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
      "/workspace/eslint-rules",
      workspaceSource.directory("eslint-rules"),
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
function getPreparedMountedWorkspace(
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
// Backend helpers (from backend.ts)
// ============================================================

function getBackendPrepared(
  workspaceSource: Directory,
  preparedWorkspace?: Container,
): Container {
  const base = preparedWorkspace ?? getPreparedWorkspace(workspaceSource);
  return base.withWorkdir("/workspace/packages/backend");
}

function buildBackendImage(
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
    .withLabel("healthcheck.retries", "3");
}

async function smokeTestBackendImageWithContainer(
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
    } catch (_stderrError) {
      return `Smoke test failed: Could not capture container output. Error: ${String(error)}`;
    }
  }

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
// Frontend helpers (from frontend.ts)
// ============================================================

function buildFrontend(
  workspaceSource: Directory,
  preparedWorkspace?: Container,
): Directory {
  const base = preparedWorkspace ?? getPreparedWorkspace(workspaceSource);
  const container = base
    .withWorkdir("/workspace/packages/frontend")
    .withExec(["bun", "run", "build"]);
  return container.directory("/workspace/packages/frontend/dist");
}

// ============================================================
// Desktop helpers (from desktop.ts)
// ============================================================

type DesktopTarget = "linux" | "windows-gnu";

function getRustTauriContainer(): Container {
  return dag
    .container()
    .from("rust:latest")
    .withWorkdir("/workspace")
    .withMountedCache("/var/cache/apt", dag.cacheVolume("apt-cache-rust"))
    .withMountedCache("/var/lib/apt/lists", dag.cacheVolume("apt-lists-rust"))
    .withExec(["apt", "update"])
    .withExec([
      "apt",
      "install",
      "-y",
      "libwebkit2gtk-4.1-dev",
      "libgtk-3-dev",
      "libayatana-appindicator3-dev",
      "librsvg2-dev",
      "patchelf",
      "cmake",
      "pkg-config",
      "curl",
      "ca-certificates",
      "gnupg",
      "clang",
      "mold",
      "libasound2-dev",
    ])
    .withExec([
      "sh",
      "-c",
      "curl -L https://github.com/mozilla/sccache/releases/download/v0.8.1/sccache-v0.8.1-x86_64-unknown-linux-musl.tar.gz | tar xz && mv sccache-v0.8.1-x86_64-unknown-linux-musl/sccache /usr/local/bin/ && rm -rf sccache-v0.8.1-x86_64-unknown-linux-musl",
    ])
    .withExec(["cargo", "install", "cargo-chef", "--locked"])
    .withMountedCache("/root/.cache/sccache", dag.cacheVolume("sccache"))
    .withEnvVariable("RUSTC_WRAPPER", "sccache")
    .withEnvVariable("SCCACHE_DIR", "/root/.cache/sccache")
    .withMountedCache(
      "/usr/local/cargo/registry",
      dag.cacheVolume("cargo-registry"),
    )
    .withMountedCache("/usr/local/cargo/git", dag.cacheVolume("cargo-git"))
    .withEnvVariable("CARGO_INCREMENTAL", "0")
    .withEnvVariable("CARGO_BUILD_JOBS", "4")
    .withEnvVariable("CARGO_NET_GIT_FETCH_WITH_CLI", "false")
    .withEnvVariable("CARGO_REGISTRIES_CRATES_IO_PROTOCOL", "sparse")
    .withEnvVariable("CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER", "clang")
    .withEnvVariable("RUSTFLAGS", "-C link-arg=-fuse-ld=mold")
    .withExec(["cargo", "install", "tauri-cli", "--locked"]);
}

function installBunInRustContainer(container: Container): Container {
  return container
    .withExec(["sh", "-c", "curl -fsSL https://bun.sh/install | bash"])
    .withEnvVariable("PATH", "/root/.bun/bin:$PATH", { expand: true });
}

function installDesktopDeps(
  workspaceSource: Directory,
  target: DesktopTarget = "linux",
): Container {
  let container = getRustTauriContainer();
  container = installBunInRustContainer(container);
  container = container.withMountedCache(
    "/root/.bun/install/cache",
    dag.cacheVolume("bun-install-cache"),
  );

  if (target === "windows-gnu") {
    container = container
      .withExec(["apt", "install", "-y", "mingw-w64", "nsis", "zip"])
      .withExec(["rustup", "target", "add", "x86_64-pc-windows-gnu"])
      .withExec([
        "rustup",
        "target",
        "add",
        "x86_64-pc-windows-gnu",
        "--toolchain",
        "stable",
      ]);
  }

  // PHASE 1: Dependency files only
  container = container
    .withWorkdir("/workspace")
    .withFile("/workspace/package.json", workspaceSource.file("package.json"))
    .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    .withDirectory("/workspace/patches", workspaceSource.directory("patches"))
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
    .withDirectory(
      "/workspace/eslint-rules",
      workspaceSource.directory("eslint-rules"),
    )
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

function buildDesktopFrontend(workspaceSource: Directory): Directory {
  return installDesktopDeps(workspaceSource)
    .withWorkdir("/workspace/packages/desktop")
    .withExec(["bunx", "vite", "build"])
    .directory("/workspace/packages/desktop/dist");
}

function checkDesktopParallel(
  workspaceSource: Directory,
  frontendDist?: Directory,
): Promise<void> {
  const baseContainer = installDesktopDeps(workspaceSource);
  const frontend = frontendDist ?? buildDesktopFrontend(workspaceSource);

  const containerWithFrontend = baseContainer
    .withDirectory("/workspace/packages/desktop/dist", frontend)
    .withMountedCache(
      "/workspace/packages/desktop/src-tauri/target",
      dag.cacheVolume("rust-target-linux"),
    );

  return Promise.all([
    // TypeScript checks (don't need Rust)
    baseContainer
      .withWorkdir("/workspace/packages/desktop")
      .withExec(["bun", "run", "typecheck"])
      .withExec(["bun", "run", "lint"])
      .sync(),
    // Rust checks (need frontend built for Tauri)
    containerWithFrontend
      .withWorkdir("/workspace/packages/desktop/src-tauri")
      .withExec(["cargo", "fmt", "--", "--check"])
      .withExec([
        "cargo",
        "clippy",
        "--all-targets",
        "--all-features",
        "--",
        "-D",
        "warnings",
      ])
      .withExec(["cargo", "test", "--verbose"])
      .sync(),
  ]).then(() => {});
}

function buildDesktopWindowsGnu(
  workspaceSource: Directory,
  version: string,
  frontendDist?: Directory,
): Container {
  let container = installDesktopDeps(workspaceSource, "windows-gnu")
    .withEnvVariable("VERSION", version)
    .withEnvVariable(
      "CARGO_TARGET_DIR",
      "/workspace/packages/desktop/src-tauri/target",
    )
    .withEnvVariable("RUSTUP_HOME", "/usr/local/rustup")
    .withEnvVariable("CARGO_HOME", "/usr/local/cargo")
    .withEnvVariable(
      "PATH",
      "/usr/local/cargo/bin:/usr/local/rustup/bin:$PATH",
      { expand: true },
    )
    .withMountedCache(
      "/root/.cache/sccache",
      dag.cacheVolume("sccache-windows"),
    )
    .withEnvVariable("RUSTC_WRAPPER", "sccache")
    .withEnvVariable("SCCACHE_DIR", "/root/.cache/sccache")
    .withMountedCache(
      "/workspace/packages/desktop/src-tauri/target",
      dag.cacheVolume("cargo-target-windows-gnu"),
    )
    .withWorkdir("/workspace/packages/desktop");

  if (frontendDist) {
    container = container.withDirectory(
      "/workspace/packages/desktop/dist",
      frontendDist,
    );
  } else {
    container = container.withExec(["bunx", "vite", "build"]);
  }

  return container
    .withWorkdir("/workspace/packages/desktop/src-tauri")
    .withExec([
      "cargo",
      "build",
      "--release",
      "--target",
      "x86_64-pc-windows-gnu",
    ])
    .withExec([
      "sh",
      "-c",
      "mkdir -p /artifacts && cp target/x86_64-pc-windows-gnu/release/scout-for-lol-desktop.exe /artifacts/",
    ]);
}

// ============================================================
// GitHub release helpers (from index.ts publishDesktopArtifactsWindowsOnly)
// ============================================================

async function publishDesktopArtifactsWindowsOnly(
  windowsContainer: Container,
  version: string,
  gitSha: string,
  ghToken: Secret,
  repo = "shepherdjerred/scout-for-lol",
): Promise<string> {
  logWithTimestamp(
    `Publishing Windows desktop artifacts to GitHub Releases for version ${version}`,
  );

  const windowsArtifactsDir = windowsContainer.directory("/artifacts");

  const container = getGitHubContainer()
    .withSecretVariable("GH_TOKEN", ghToken)
    .withWorkdir("/artifacts")
    .withDirectory("/artifacts/windows", windowsArtifactsDir)
    .withExec([
      "sh",
      "-c",
      "echo 'Windows artifacts:' && find windows -type f",
    ]);

  // Verify GitHub authentication
  const authCheckContainer = container.withExec([
    "sh",
    "-c",
    'gh auth status 2>&1; echo "AUTH_EXIT_CODE=$?"',
  ]);
  const authOutput = await authCheckContainer.stdout();
  if (!authOutput.includes("AUTH_EXIT_CODE=0")) {
    throw new Error(`GitHub authentication failed: ${authOutput}`);
  }

  // Check if release exists
  const checkReleaseContainer = container.withExec([
    "sh",
    "-c",
    `if gh release view "v${version}" --repo="${repo}" > /dev/null 2>&1; then echo "RELEASE_EXISTS"; else echo "RELEASE_NOT_FOUND"; fi`,
  ]);
  const checkOutput = await checkReleaseContainer.stdout();
  const releaseExists = checkOutput.includes("RELEASE_EXISTS");

  // Create release if it doesn't exist
  let releaseContainer = checkReleaseContainer;
  if (!releaseExists) {
    releaseContainer = releaseContainer.withExec([
      "gh",
      "release",
      "create",
      `v${version}`,
      `--repo=${repo}`,
      `--title=v${version}`,
      `--notes=Release ${version} (${gitSha.substring(0, 7)})`,
      "--latest",
    ]);
    await releaseContainer.sync();
  }

  // Upload Windows artifacts
  releaseContainer = releaseContainer.withExec([
    "sh",
    "-c",
    `find windows -type f \\( -name "*.exe" -o -name "*.msi" \\) -exec gh release upload "v${version}" {} --repo="${repo}" --clobber \\; 2>&1 || (echo 'Windows upload failed' && exit 1)`,
  ]);
  await releaseContainer.sync();

  return `Windows desktop artifacts published to GitHub Releases: v${version}`;
}

// ============================================================
// Exported functions
// ============================================================

/**
 * Run all checks for scout-for-lol: typecheck, lint, test, duplication, desktop checks.
 * Extracts the scout-for-lol package from the monorepo source and uses the
 * nested workspace's own bun.lock for dependency resolution.
 */
export async function checkScoutForLol(source: Directory): Promise<string> {
  const pkgSource = source.directory("packages/scout-for-lol");

  logWithTimestamp("Starting comprehensive check process for scout-for-lol");

  // Generate Prisma client once and share
  const prismaGenerated = generatePrismaClient(pkgSource);

  // Use mounted workspace for CI checks (faster than copying files)
  const preparedWorkspace = getPreparedMountedWorkspace(
    pkgSource,
    prismaGenerated,
  );

  // Build desktop frontend once and share
  const desktopFrontend = buildDesktopFrontend(pkgSource);

  // Run all checks in parallel for maximum speed
  await withTiming("all checks", async () => {
    await Promise.all([
      withTiming("typecheck all", async () => {
        await preparedWorkspace
          .withWorkdir("/workspace")
          .withExec(["bun", "run", "typecheck"])
          .sync();
      }),
      withTiming("lint all", async () => {
        await preparedWorkspace
          .withWorkdir("/workspace")
          .withExec([
            "bunx",
            "eslint",
            "packages/",
            "--cache",
            "--cache-strategy",
            "content",
            "--cache-location",
            "/workspace/.eslintcache",
          ])
          .sync();
      }),
      withTiming("test all", async () => {
        await preparedWorkspace
          .withWorkdir("/workspace")
          .withExec(["bun", "run", "test"])
          .sync();
      }),
      withTiming("duplication check", async () => {
        await preparedWorkspace
          .withWorkdir("/workspace")
          .withExec(["bun", "run", "duplication-check"])
          .sync();
      }),
      withTiming("desktop check (parallel TS + Rust)", async () => {
        await checkDesktopParallel(pkgSource, desktopFrontend);
      }),
    ]);
  });

  logWithTimestamp("All checks completed successfully for scout-for-lol");
  return "All checks completed successfully";
}

/**
 * Deploy scout-for-lol: backend GHCR + homelab, S3 frontend, GitHub Releases desktop.
 * Extracts the scout-for-lol package from the monorepo source and uses the
 * nested workspace's own bun.lock for dependency resolution.
 */
export async function deployScoutForLol(
  source: Directory,
  version: string,
  gitSha: string,
  ghcrUsername: string,
  ghcrPassword: Secret,
  ghToken: Secret,
  s3AccessKeyId: Secret,
  s3SecretAccessKey: Secret,
): Promise<string> {
  const pkgSource = source.directory("packages/scout-for-lol");
  const outputs: string[] = [];

  logWithTimestamp(
    `Starting deploy for scout-for-lol version ${version} (${gitSha})`,
  );

  // Generate Prisma client once
  const prismaGenerated = generatePrismaClient(pkgSource);
  const preparedWorkspace = getPreparedWorkspace(pkgSource, prismaGenerated);

  // Build desktop frontend once and share across desktop operations
  const desktopFrontend = buildDesktopFrontend(pkgSource);

  // Build backend image and desktop Windows build in parallel
  const backendImagePromise = withTiming(
    "backend Docker image build",
    async () => {
      const image = buildBackendImage(
        pkgSource,
        version,
        gitSha,
        preparedWorkspace,
      );
      await image.id();
      return image;
    },
  );

  const desktopBuildWindowsPromise = withTiming(
    "desktop application build (Windows)",
    async () => {
      const container = buildDesktopWindowsGnu(
        pkgSource,
        version,
        desktopFrontend,
      );
      await container.sync();
      return container;
    },
  );

  const [backendImage, desktopWindowsContainer] = await Promise.all([
    backendImagePromise,
    desktopBuildWindowsPromise,
  ]);

  // Smoke test the backend image
  await withTiming("backend image smoke test", async () => {
    const smokeTestResult = await smokeTestBackendImageWithContainer(
      backendImage,
      pkgSource,
    );
    logWithTimestamp(`Smoke test result: ${smokeTestResult}`);
    if (smokeTestResult.includes("Smoke test failed")) {
      throw new Error(`Backend image smoke test failed: ${smokeTestResult}`);
    }
  });
  outputs.push("Backend image smoke test passed");

  // Publish backend image to GHCR
  await withTiming("backend GHCR publish", async () => {
    const backendImageName = "ghcr.io/shepherdjerred/scout-for-lol";
    await publishToGhcrMultiple({
      container: backendImage,
      imageRefs: [
        `${backendImageName}:${version}`,
        `${backendImageName}:${gitSha}`,
      ],
      username: ghcrUsername,
      password: ghcrPassword,
    });
  });
  outputs.push("Backend published to GHCR");

  // Deploy backend to homelab (beta stage)
  await withTiming("backend homelab deploy", async () => {
    await updateHomelabVersion({
      ghToken,
      appName: "scout-for-lol/beta",
      version,
    });
  });
  outputs.push("Backend deployed to homelab (beta)");

  // Deploy frontend to S3
  await withTiming("frontend S3 deploy", async () => {
    const frontendDist = buildFrontend(pkgSource);
    const syncOutput = await syncToS3({
      sourceDir: frontendDist,
      bucketName: "scout-frontend",
      endpointUrl: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      region: "us-east-1",
      deleteRemoved: true,
    });
    logWithTimestamp(`Frontend deployed to S3: ${syncOutput}`);
  });
  outputs.push("Frontend deployed to S3");

  // Publish desktop artifacts to GitHub Releases (Windows only)
  await withTiming("desktop GitHub Releases publish", async () => {
    await publishDesktopArtifactsWindowsOnly(
      desktopWindowsContainer,
      version,
      gitSha,
      ghToken,
    );
  });
  outputs.push("Desktop artifacts published to GitHub Releases");

  logWithTimestamp("Deploy completed successfully for scout-for-lol");
  return outputs.join("\n");
}
