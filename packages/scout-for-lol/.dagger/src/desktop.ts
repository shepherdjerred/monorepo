import type { Directory, Container } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";

type DesktopTarget = "linux" | "windows-gnu";

/**
 * Get a Rust container with Tauri dependencies, sccache, and cargo-chef for faster builds
 * cargo-chef enables better caching by separating dependency compilation from app compilation
 * @returns A Rust container with system dependencies for Tauri
 */
export function getRustTauriContainer(): Container {
  return (
    dag
      .container()
      .from("rust:latest")
      .withWorkdir("/workspace")
      // Install system dependencies needed for Tauri on Linux
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
        "clang", // Required for mold linker
        "mold", // Modern linker - much faster than ld
        "libasound2-dev", // ALSA audio library for audio playback
      ])
      // Install sccache via pre-built binary (much faster than cargo install)
      // sccache caches compiled object files based on content hashes - safe and deterministic
      .withExec([
        "sh",
        "-c",
        "curl -L https://github.com/mozilla/sccache/releases/download/v0.8.1/sccache-v0.8.1-x86_64-unknown-linux-musl.tar.gz | tar xz && mv sccache-v0.8.1-x86_64-unknown-linux-musl/sccache /usr/local/bin/ && rm -rf sccache-v0.8.1-x86_64-unknown-linux-musl",
      ])
      // Install cargo-chef for better dependency caching
      // cargo-chef separates dependency compilation from app code compilation
      .withExec(["cargo", "install", "cargo-chef", "--locked"])
      // Mount sccache directory for cross-run caching
      .withMountedCache("/root/.cache/sccache", dag.cacheVolume("sccache"))
      // Configure sccache as the Rust compiler wrapper
      .withEnvVariable("RUSTC_WRAPPER", "sccache")
      .withEnvVariable("SCCACHE_DIR", "/root/.cache/sccache")
      // Mount Cargo caches for faster builds
      // - registry: Downloaded crate sources and metadata
      // - git: Git dependencies
      .withMountedCache("/usr/local/cargo/registry", dag.cacheVolume("cargo-registry"))
      .withMountedCache("/usr/local/cargo/git", dag.cacheVolume("cargo-git"))
      // Cargo build optimizations via environment variables
      // NOTE: CARGO_INCREMENTAL must be 0 when using sccache (they're incompatible)
      .withEnvVariable("CARGO_INCREMENTAL", "0")
      .withEnvVariable("CARGO_BUILD_JOBS", "4") // Parallel compilation jobs
      .withEnvVariable("CARGO_NET_GIT_FETCH_WITH_CLI", "false") // Faster git fetching
      .withEnvVariable("CARGO_REGISTRIES_CRATES_IO_PROTOCOL", "sparse") // Sparse index protocol
      // Use mold linker for faster linking on Linux (x86_64)
      .withEnvVariable("CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER", "clang")
      .withEnvVariable("RUSTFLAGS", "-C link-arg=-fuse-ld=mold")
      // Install Tauri CLI for `cargo tauri build`
      .withExec(["cargo", "install", "tauri-cli", "--locked"])
  );
}

/**
 * Prepare cargo-chef recipe for dependency caching.
 * This analyzes Cargo.toml/Cargo.lock and creates a recipe.json that can be cached.
 * @param workspaceSource The full workspace source directory
 * @returns Container with prepared recipe
 */
export function prepareCargoChefRecipe(workspaceSource: Directory): Container {
  return getRustTauriContainer()
    .withDirectory("/workspace/packages/desktop/src-tauri", workspaceSource.directory("packages/desktop/src-tauri"))
    .withWorkdir("/workspace/packages/desktop/src-tauri")
    .withExec(["cargo", "chef", "prepare", "--recipe-path", "recipe.json"]);
}

/**
 * Cook cargo-chef recipe (compile dependencies only).
 * This step is cached and only invalidated when Cargo.toml/Cargo.lock change.
 * @param workspaceSource The full workspace source directory
 * @param target The build target (linux or windows-gnu)
 * @param release Whether to build in release mode
 * @returns Container with pre-compiled dependencies
 */
export function cookCargoChefRecipe(
  workspaceSource: Directory,
  target: DesktopTarget = "linux",
  release = false,
): Container {
  const recipeContainer = prepareCargoChefRecipe(workspaceSource);
  const recipeFile = recipeContainer.file("/workspace/packages/desktop/src-tauri/recipe.json");

  let container = getRustTauriContainer()
    .withFile("/workspace/packages/desktop/src-tauri/recipe.json", recipeFile)
    .withWorkdir("/workspace/packages/desktop/src-tauri");

  // Add Windows cross-compilation target if needed
  if (target === "windows-gnu") {
    container = container
      .withExec(["apt", "install", "-y", "mingw-w64", "nsis", "zip"])
      .withExec(["rustup", "target", "add", "x86_64-pc-windows-gnu"])
      .withExec(["rustup", "target", "add", "x86_64-pc-windows-gnu", "--toolchain", "stable"]);
  }

  // Mount target cache for compiled dependencies
  const cacheKey = target === "windows-gnu" ? "cargo-chef-windows-gnu" : "cargo-chef-linux";
  container = container.withMountedCache("/workspace/packages/desktop/src-tauri/target", dag.cacheVolume(cacheKey));

  // Build command with appropriate flags
  const cookArgs = ["cargo", "chef", "cook", "--recipe-path", "recipe.json"];
  if (release) {
    cookArgs.push("--release");
  }
  if (target === "windows-gnu") {
    cookArgs.push("--target", "x86_64-pc-windows-gnu");
  }

  return container.withExec(cookArgs);
}

/**
 * Install Bun in a Rust container
 * @param container The Rust container to install Bun in
 * @returns The container with Bun installed
 */
export function installBunInRustContainer(container: Container): Container {
  return container
    .withExec(["sh", "-c", "curl -fsSL https://bun.sh/install | bash"])
    .withEnvVariable("PATH", "/root/.bun/bin:$PATH", { expand: true });
}

/**
 * Install dependencies for the desktop package
 *
 * LAYER ORDERING FOR CACHING:
 * 1. System deps (apt, Rust, Tauri CLI) - rarely change
 * 2. Dependency files (package.json, bun.lock, patches) - change occasionally
 * 3. bun install - cached if lockfile unchanged
 * 4. Config files + source code - change frequently
 *
 * @param workspaceSource The full workspace source directory
 * @param target Which desktop target to prepare for (linux or Windows GNU cross-compile)
 * @returns The container with dependencies installed
 */
export function installDesktopDeps(workspaceSource: Directory, target: DesktopTarget = "linux"): Container {
  let container = getRustTauriContainer();

  // Install Bun for frontend dependencies
  container = installBunInRustContainer(container);

  // Mount Bun install cache
  container = container.withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-install-cache"));

  if (target === "windows-gnu") {
    // Dependencies for cross-compiling Windows GNU target
    container = container
      .withExec(["apt", "install", "-y", "mingw-w64", "nsis", "zip"])
      .withExec(["sh", "-c", "echo '🔧 Installing Windows GNU target for cross-compilation...'"])
      // Install target for both default and stable toolchains since rust-toolchain.toml uses stable
      .withExec(["rustup", "target", "add", "x86_64-pc-windows-gnu"])
      .withExec(["rustup", "target", "add", "x86_64-pc-windows-gnu", "--toolchain", "stable"])
      .withExec(["sh", "-c", "echo '✅ Windows GNU target installed for both default and stable toolchains'"]);
  }

  // PHASE 1: Dependency files only (for bun install caching)
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
  return (
    container
      // Config files
      .withFile("/workspace/tsconfig.json", workspaceSource.file("tsconfig.json"))
      .withFile("/workspace/tsconfig.base.json", workspaceSource.file("tsconfig.base.json"))
      .withFile("/workspace/eslint.config.ts", workspaceSource.file("eslint.config.ts"))
      .withFile("/workspace/.jscpd.json", workspaceSource.file(".jscpd.json"))
      .withDirectory("/workspace/eslint-rules", workspaceSource.directory("eslint-rules"))
      // Scripts directory (for utility scripts like check-suppressions)
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
 * Build the desktop frontend (Vite) and return the dist directory.
 * This can be shared across multiple desktop operations to avoid rebuilding.
 * @param workspaceSource The full workspace source directory
 * @returns The built frontend dist directory
 */
export function buildDesktopFrontend(workspaceSource: Directory): Directory {
  return installDesktopDeps(workspaceSource)
    .withWorkdir("/workspace/packages/desktop")
    .withExec(["sh", "-c", "echo '🏗️  Building desktop frontend (Vite)...'"])
    .withExec(["bunx", "vite", "build"])
    .withExec(["sh", "-c", "echo '✅ Desktop frontend built successfully'"])
    .directory("/workspace/packages/desktop/dist");
}

/**
 * Run Rust formatting check
 * @param workspaceSource The full workspace source directory
 * @returns The container with fmt check results
 */
export function checkDesktopRustFmt(workspaceSource: Directory): Container {
  return installDesktopDeps(workspaceSource)
    .withWorkdir("/workspace/packages/desktop/src-tauri")
    .withMountedCache("/workspace/packages/desktop/src-tauri/target", dag.cacheVolume("rust-target-linux"))
    .withExec(["sh", "-c", "echo '🎨 [CI] Running Rust formatting check for desktop...'"])
    .withExec(["cargo", "fmt", "--", "--check"])
    .withExec(["sh", "-c", "echo '✅ [CI] Rust formatting check passed!'"]);
}

/**
 * Run Rust linting with clippy
 * @param workspaceSource The full workspace source directory
 * @returns The container with clippy results
 */
export function checkDesktopRustClippy(workspaceSource: Directory): Container {
  return installDesktopDeps(workspaceSource)
    .withWorkdir("/workspace/packages/desktop/src-tauri")
    .withMountedCache("/workspace/packages/desktop/src-tauri/target", dag.cacheVolume("rust-target-linux"))
    .withExec(["sh", "-c", "echo '🔍 [CI] Running Rust clippy for desktop...'"])
    .withExec(["cargo", "clippy", "--all-targets", "--all-features", "--", "-D", "warnings"])
    .withExec(["sh", "-c", "echo '✅ [CI] Rust clippy passed!'"]);
}

/**
 * Run Rust tests
 * @param workspaceSource The full workspace source directory
 * @returns The container with test results
 */
export function checkDesktopRustTests(workspaceSource: Directory): Container {
  return installDesktopDeps(workspaceSource)
    .withWorkdir("/workspace/packages/desktop/src-tauri")
    .withMountedCache("/workspace/packages/desktop/src-tauri/target", dag.cacheVolume("rust-target-linux"))
    .withExec(["sh", "-c", "echo '🧪 [CI] Running Rust tests for desktop...'"])
    .withExec(["cargo", "test", "--verbose"])
    .withExec(["sh", "-c", "echo '✅ [CI] Rust tests passed!'"]);
}

/**
 * Run TypeScript type checking for desktop
 * @param workspaceSource The full workspace source directory
 * @returns The container with typecheck results
 */
export function checkDesktopTypeScript(workspaceSource: Directory): Container {
  return installDesktopDeps(workspaceSource)
    .withWorkdir("/workspace/packages/desktop")
    .withExec(["sh", "-c", "echo '🔍 [CI] Running TypeScript type checking for desktop...'"])
    .withExec(["bun", "run", "typecheck"])
    .withExec(["sh", "-c", "echo '✅ [CI] TypeScript type checking passed!'"]);
}

/**
 * Run ESLint for desktop
 * @param workspaceSource The full workspace source directory
 * @returns The container with lint results
 */
export function checkDesktopLint(workspaceSource: Directory): Container {
  return installDesktopDeps(workspaceSource)
    .withWorkdir("/workspace/packages/desktop")
    .withExec(["sh", "-c", "echo '🔍 [CI] Running ESLint for desktop...'"])
    .withExec(["bun", "run", "lint"])
    .withExec(["sh", "-c", "echo '✅ [CI] ESLint passed!'"]);
}

/**
 * Run all checks for desktop (TypeScript, Rust fmt, clippy, tests)
 * This runs TypeScript and Rust checks in PARALLEL for faster execution.
 * @param workspaceSource The full workspace source directory
 * @param frontendDist Optional pre-built frontend dist directory (avoids rebuilding)
 * @returns Promise that resolves when all checks pass
 */
export async function checkDesktopParallel(workspaceSource: Directory, frontendDist?: Directory): Promise<void> {
  // Get the base container with deps installed
  const baseContainer = installDesktopDeps(workspaceSource);

  // Build frontend if not provided (needed for Rust compilation)
  const frontend = frontendDist ?? buildDesktopFrontend(workspaceSource);

  // Container with frontend for Rust checks
  const containerWithFrontend = baseContainer
    .withDirectory("/workspace/packages/desktop/dist", frontend)
    .withMountedCache("/workspace/packages/desktop/src-tauri/target", dag.cacheVolume("rust-target-linux"));

  // Run TypeScript and Rust checks in PARALLEL
  await Promise.all([
    // TypeScript checks (don't need Rust)
    baseContainer
      .withWorkdir("/workspace/packages/desktop")
      .withExec(["sh", "-c", "echo '📋 [CI] Running TypeScript checks for desktop...'"])
      .withExec(["bun", "run", "typecheck"])
      .withExec(["bun", "run", "lint"])
      .withExec(["sh", "-c", "echo '✅ [CI] TypeScript checks passed!'"])
      .sync(),

    // Rust checks (need frontend built for Tauri)
    containerWithFrontend
      .withWorkdir("/workspace/packages/desktop/src-tauri")
      .withExec(["sh", "-c", "echo '📋 [CI] Running Rust checks for desktop...'"])
      .withExec(["cargo", "fmt", "--", "--check"])
      .withExec(["cargo", "clippy", "--all-targets", "--all-features", "--", "-D", "warnings"])
      .withExec(["cargo", "test", "--verbose"])
      .withExec(["sh", "-c", "echo '✅ [CI] Rust checks passed!'"])
      .sync(),
  ]);
}

/**
 * Run all checks for desktop (TypeScript, Rust fmt, clippy, tests)
 * Sequential version that returns a container (for backwards compatibility).
 * @param workspaceSource The full workspace source directory
 * @param frontendDist Optional pre-built frontend dist directory (avoids rebuilding)
 * @returns The container with all check results
 */
export function checkDesktop(workspaceSource: Directory, frontendDist?: Directory): Container {
  let container = installDesktopDeps(workspaceSource)
    .withWorkdir("/workspace/packages/desktop")
    .withMountedCache("/workspace/packages/desktop/src-tauri/target", dag.cacheVolume("rust-target-linux"))
    .withExec(["sh", "-c", "echo '🔍 [CI] Running all checks for desktop package...'"])
    .withExec(["sh", "-c", "echo '📋 TypeScript checks...'"])
    .withExec(["bun", "run", "typecheck"])
    .withExec(["bun", "run", "lint"]);

  // Use pre-built frontend if provided, otherwise build it
  if (frontendDist) {
    container = container
      .withDirectory("/workspace/packages/desktop/dist", frontendDist)
      .withExec(["sh", "-c", "echo '📦 Using pre-built frontend...'"]);
  } else {
    container = container
      .withExec(["sh", "-c", "echo '🏗️  Building frontend for Rust compilation...'"])
      .withExec(["bun", "run", "build:frontend"]);
  }

  return container
    .withExec(["sh", "-c", "echo '📋 Rust checks...'"])
    .withWorkdir("/workspace/packages/desktop/src-tauri")
    .withExec(["cargo", "fmt", "--", "--check"])
    .withExec(["cargo", "clippy", "--all-targets", "--all-features", "--", "-D", "warnings"])
    .withExec(["cargo", "test", "--verbose"])
    .withExec(["sh", "-c", "echo '✅ [CI] All desktop checks completed successfully!'"]);
}

/**
 * Build the desktop application for Linux
 * Uses cargo-chef for better dependency caching - dependencies are compiled separately
 * and cached, so only app code needs to recompile on changes.
 * @param workspaceSource The full workspace source directory
 * @param version The version tag
 * @param frontendDist Optional pre-built frontend dist directory (avoids rebuilding)
 * @returns The container with built artifacts
 */
export function buildDesktopLinux(workspaceSource: Directory, version: string, frontendDist?: Directory): Container {
  // Build with sccache for compilation caching + mounted target cache
  let container = installDesktopDeps(workspaceSource)
    .withEnvVariable("VERSION", version)
    // Mount sccache for compilation caching
    .withMountedCache("/root/.cache/sccache", dag.cacheVolume("sccache-linux"))
    .withEnvVariable("RUSTC_WRAPPER", "sccache")
    .withEnvVariable("SCCACHE_DIR", "/root/.cache/sccache")
    // Mount target cache for incremental builds
    .withMountedCache("/workspace/packages/desktop/src-tauri/target", dag.cacheVolume("cargo-target-linux"))
    .withWorkdir("/workspace/packages/desktop")
    .withExec(["sh", "-c", "echo '🏗️  [CI] Building desktop application for Linux...'"]);

  // Use pre-built frontend if provided
  if (frontendDist) {
    container = container
      .withDirectory("/workspace/packages/desktop/dist", frontendDist)
      .withExec(["sh", "-c", "echo '📦 Using pre-built frontend, running Tauri build...'"])
      .withWorkdir("/workspace/packages/desktop/src-tauri")
      .withExec(["cargo", "tauri", "build"]);
  } else {
    // Build everything (frontend + Tauri)
    container = container.withExec(["bun", "run", "build"]);
  }

  // Copy artifacts from target cache to permanent location in container filesystem
  return container
    .withExec(["sh", "-c", "echo '📦 Copying artifacts to permanent location...'"])
    .withExec([
      "sh",
      "-c",
      "mkdir -p /artifacts && cp -r /workspace/packages/desktop/src-tauri/target/release/bundle /artifacts/",
    ])
    .withExec(["sh", "-c", "echo '✅ [CI] Desktop build completed!'"]);
}

/**
 * Build the desktop application for Windows (x86_64-pc-windows-gnu)
 * Uses sccache for compilation caching and mounted target cache for incremental builds.
 * @param workspaceSource The full workspace source directory
 * @param version The version tag
 * @param frontendDist Optional pre-built frontend dist directory (avoids rebuilding)
 * @returns The container with built artifacts
 */
export function buildDesktopWindowsGnu(
  workspaceSource: Directory,
  version: string,
  frontendDist?: Directory,
): Container {
  // Build with sccache for compilation caching + mounted target cache
  let container = installDesktopDeps(workspaceSource, "windows-gnu")
    .withEnvVariable("VERSION", version)
    .withEnvVariable("CARGO_TARGET_DIR", "/workspace/packages/desktop/src-tauri/target")
    .withEnvVariable("RUSTUP_HOME", "/usr/local/rustup")
    .withEnvVariable("CARGO_HOME", "/usr/local/cargo")
    .withEnvVariable("PATH", "/usr/local/cargo/bin:/usr/local/rustup/bin:$PATH", { expand: true })
    // Mount sccache for compilation caching
    .withMountedCache("/root/.cache/sccache", dag.cacheVolume("sccache-windows"))
    .withEnvVariable("RUSTC_WRAPPER", "sccache")
    .withEnvVariable("SCCACHE_DIR", "/root/.cache/sccache")
    // Mount target cache for incremental builds
    .withMountedCache("/workspace/packages/desktop/src-tauri/target", dag.cacheVolume("cargo-target-windows-gnu"))
    .withWorkdir("/workspace/packages/desktop")
    .withExec(["sh", "-c", "echo '🏗️  [CI] Building desktop application for Windows (x86_64-pc-windows-gnu)...'"]);

  // Use pre-built frontend if provided, otherwise build it
  if (frontendDist) {
    container = container
      .withDirectory("/workspace/packages/desktop/dist", frontendDist)
      .withExec(["sh", "-c", "echo '📦 Using pre-built frontend...'"]);
  } else {
    container = container
      .withExec(["sh", "-c", "echo '📦 Building frontend first...'"])
      .withExec(["bunx", "vite", "build"]);
  }

  // Build app code (sccache handles compilation caching)
  return container
    .withExec(["sh", "-c", "echo '🦀 Building Rust application with Cargo...'"])
    .withWorkdir("/workspace/packages/desktop/src-tauri")
    .withExec(["cargo", "build", "--release", "--target", "x86_64-pc-windows-gnu"])
    .withExec([
      "sh",
      "-c",
      "echo '✅ Binary built successfully at target/x86_64-pc-windows-gnu/release/scout-for-lol-desktop.exe'",
    ])
    .withExec(["sh", "-c", "ls -lh target/x86_64-pc-windows-gnu/release/scout-for-lol-desktop.exe"])
    .withExec(["sh", "-c", "echo '📦 Copying artifacts from cache to permanent location...'"])
    .withExec([
      "sh",
      "-c",
      "mkdir -p /artifacts && cp target/x86_64-pc-windows-gnu/release/scout-for-lol-desktop.exe /artifacts/",
    ])
    .withWorkdir("/workspace/packages/desktop")
    .withExec(["sh", "-c", "echo '✅ [CI] Desktop Windows (GNU) build completed!'"]);
}

/**
 * Export desktop Linux build artifacts
 * @param workspaceSource The full workspace source directory
 * @param version The version tag
 * @returns The directory containing built artifacts
 */
export function getDesktopLinuxArtifacts(workspaceSource: Directory, version: string): Directory {
  // Artifacts are copied to /artifacts/bundle during build to persist beyond the cache mount
  return buildDesktopLinux(workspaceSource, version).directory("/artifacts/bundle");
}

/**
 * Export desktop Windows (x86_64-pc-windows-gnu) build artifacts
 * @param workspaceSource The full workspace source directory
 * @param version The version tag
 * @returns The directory containing built artifacts (exe file)
 */
export function getDesktopWindowsArtifacts(workspaceSource: Directory, version: string): Directory {
  // Artifacts are copied to /artifacts during build to persist beyond the cache mount
  return buildDesktopWindowsGnu(workspaceSource, version).directory("/artifacts");
}
