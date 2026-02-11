import type { Secret, Directory, Container, File } from "@dagger.io/dagger";
import { dag, object, func } from "@dagger.io/dagger";
import { updateHomelabVersion, syncToS3 } from "@shepherdjerred/dagger-utils/containers";
import {
  checkBirmel,
  buildBirmelImage,
  smokeTestBirmelImageWithContainer,
  publishBirmelImageWithContainer,
} from "./birmel.js";
import { reviewPr, handleInteractive } from "./code-review.js";

const PACKAGES = ["eslint-config", "dagger-utils", "bun-decompile"] as const;
const REPO_URL = "shepherdjerred/monorepo";

const BUN_VERSION = "1.3.6";
const PLAYWRIGHT_VERSION = "1.57.0";
// Pin release-please version for reproducible builds
const RELEASE_PLEASE_VERSION = "17.1.3";
// Rust version for clauderon
const RUST_VERSION = "1.85";
// LaTeX image for resume builds
const LATEX_IMAGE = "blang/latex:ubuntu";
// sccache version for Rust compilation caching
const SCCACHE_VERSION = "0.9.1";

// Cross-compilation targets for clauderon binary
const CLAUDERON_TARGETS = [
  { target: "x86_64-unknown-linux-gnu", os: "linux", arch: "x86_64" },
  { target: "aarch64-unknown-linux-gnu", os: "linux", arch: "arm64" },
  { target: "x86_64-apple-darwin", os: "darwin", arch: "x86_64" },
  { target: "aarch64-apple-darwin", os: "darwin", arch: "arm64" },
] as const;

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
    .withMountedFile("/workspace/packages/eslint-config/package.json", source.file("packages/eslint-config/package.json"))
    .withMountedFile("/workspace/packages/resume/package.json", source.file("packages/resume/package.json"))
    .withMountedFile("/workspace/packages/tools/package.json", source.file("packages/tools/package.json"))
    .withMountedFile("/workspace/packages/anki/package.json", source.file("packages/anki/package.json"))
    .withMountedFile("/workspace/packages/castle-casters/package.json", source.file("packages/castle-casters/package.json"))
    .withMountedFile("/workspace/packages/macos-cross-compiler/package.json", source.file("packages/macos-cross-compiler/package.json"))
    // Clauderon web packages (nested workspace with own lockfile)
    .withMountedFile("/workspace/packages/clauderon/web/package.json", source.file("packages/clauderon/web/package.json"))
    .withMountedFile("/workspace/packages/clauderon/web/bun.lock", source.file("packages/clauderon/web/bun.lock"))
    .withMountedFile("/workspace/packages/clauderon/web/shared/package.json", source.file("packages/clauderon/web/shared/package.json"))
    .withMountedFile("/workspace/packages/clauderon/web/client/package.json", source.file("packages/clauderon/web/client/package.json"))
    .withMountedFile("/workspace/packages/clauderon/web/frontend/package.json", source.file("packages/clauderon/web/frontend/package.json"))
    // Clauderon docs (mount package.json only, will mount full dir in PHASE 3 after install)
    .withExec(["mkdir", "-p", "/workspace/packages/clauderon/docs"])
    .withMountedFile("/workspace/packages/clauderon/docs/package.json", source.file("packages/clauderon/docs/package.json"));

  // PHASE 2: Install dependencies (cached if lockfile + package.jsons unchanged)
  container = container.withExec(["bun", "install", "--frozen-lockfile"]);

  // PHASE 3: Config files and source code (changes frequently, added AFTER install)
  container = container
    .withMountedFile("/workspace/tsconfig.base.json", source.file("tsconfig.base.json"))
    .withMountedDirectory("/workspace/packages/birmel", source.directory("packages/birmel"))
    .withMountedDirectory("/workspace/packages/bun-decompile", source.directory("packages/bun-decompile"))
    .withMountedDirectory("/workspace/packages/dagger-utils", source.directory("packages/dagger-utils"))
    .withMountedDirectory("/workspace/packages/eslint-config", source.directory("packages/eslint-config"))
    .withMountedDirectory("/workspace/packages/tools", source.directory("packages/tools"))
    // Clauderon web packages
    .withMountedDirectory("/workspace/packages/clauderon/web/shared", source.directory("packages/clauderon/web/shared"))
    .withMountedDirectory("/workspace/packages/clauderon/web/client", source.directory("packages/clauderon/web/client"))
    .withMountedDirectory("/workspace/packages/clauderon/web/frontend", source.directory("packages/clauderon/web/frontend"))
    // Clauderon docs (remount with full source including screenshots)
    .withMountedDirectory("/workspace/packages/clauderon/docs", source.directory("packages/clauderon/docs"));

  // PHASE 4: Re-run bun install to recreate workspace node_modules symlinks
  // (Source mounts in Phase 3 replace the symlinks that Phase 2 created)
  container = container.withExec(["bun", "install", "--frozen-lockfile"]);

  return container;
}

/**
 * Get a Rust container with caching enabled for clauderon builds
 * @param source The full workspace source directory
 * @param frontendDist Optional pre-built frontend dist directory (from Bun container)
 * @param s3AccessKeyId Optional S3 access key for sccache
 * @param s3SecretAccessKey Optional S3 secret key for sccache
 */
function getRustContainer(
  source: Directory,
  frontendDist?: Directory,
  s3AccessKeyId?: Secret,
  s3SecretAccessKey?: Secret
): Container {
  let container = dag
    .container()
    .from(`rust:${RUST_VERSION}-bookworm`)
    .withWorkdir("/workspace")
    // Install mold linker for faster linking (~5-10x faster than ld)
    .withMountedCache("/var/cache/apt", dag.cacheVolume(`apt-cache-rust-${RUST_VERSION}`))
    .withMountedCache("/var/lib/apt", dag.cacheVolume(`apt-lib-rust-${RUST_VERSION}`))
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "mold", "clang"])
    .withMountedCache("/usr/local/cargo/registry", dag.cacheVolume("cargo-registry"))
    .withMountedCache("/usr/local/cargo/git", dag.cacheVolume("cargo-git"))
    .withMountedCache("/workspace/target", dag.cacheVolume("clauderon-target"))
    .withMountedDirectory("/workspace", source.directory("packages/clauderon"))
    .withExec(["rustup", "component", "add", "rustfmt", "clippy"]);

  // Only use sccache when S3 credentials are provided (avoid AWS metadata timeout)
  if (s3AccessKeyId && s3SecretAccessKey) {
    container = withSccache(container);
    container = container
      .withEnvVariable("RUSTC_WRAPPER", "sccache")
      .withEnvVariable("SCCACHE_BUCKET", "sccache")
      .withEnvVariable("SCCACHE_ENDPOINT", "https://seaweedfs.sjer.red")
      .withEnvVariable("SCCACHE_REGION", "us-east-1")
      .withSecretVariable("AWS_ACCESS_KEY_ID", s3AccessKeyId)
      .withSecretVariable("AWS_SECRET_ACCESS_KEY", s3SecretAccessKey);
  }

  // Mount the pre-built frontend dist if provided
  if (frontendDist) {
    container = container.withDirectory("/workspace/web/frontend/dist", frontendDist);
  }

  return container;
}

/**
 * Install sccache (Mozilla's shared compilation cache) into a container.
 * Downloads pre-built binary from GitHub releases for faster installation.
 * Uses Dagger's layer caching - download is cached as long as version doesn't change.
 *
 * @param container The container to install sccache into
 * @returns Container with sccache installed and verified
 */
function withSccache(container: Container): Container {
  const target = "x86_64-unknown-linux-musl";
  const version = SCCACHE_VERSION;
  const tarball = `sccache-v${version}-${target}.tar.gz`;
  const url = `https://github.com/mozilla/sccache/releases/download/v${version}/${tarball}`;

  return container
    .withExec(["sh", "-c", `curl -fsSL "${url}" -o /tmp/${tarball}`])
    .withExec(["tar", "xzf", `/tmp/${tarball}`, "-C", "/tmp"])
    .withExec(["mv", `/tmp/sccache-v${version}-${target}/sccache`, "/usr/local/bin/sccache"])
    .withExec(["chmod", "+x", "/usr/local/bin/sccache"])
    .withExec(["rm", "-rf", `/tmp/${tarball}`, `/tmp/sccache-v${version}-${target}`])
    .withExec(["sccache", "--version"]); // Verify installation
}

/**
 * Get a Rust container with cross-compilation toolchains for clauderon builds
 * @param source The full workspace source directory
 * @param s3AccessKeyId Optional S3 access key for sccache
 * @param s3SecretAccessKey Optional S3 secret key for sccache
 */
function getCrossCompileContainer(
  source: Directory,
  s3AccessKeyId?: Secret,
  s3SecretAccessKey?: Secret
): Container {
  let container = dag
    .container()
    .from(`rust:${RUST_VERSION}-bookworm`)
    .withWorkdir("/workspace")
    .withMountedCache("/var/cache/apt", dag.cacheVolume(`apt-cache-rust-${RUST_VERSION}-cross`))
    .withMountedCache("/var/lib/apt", dag.cacheVolume(`apt-lib-rust-${RUST_VERSION}-cross`))
    .withMountedCache("/usr/local/cargo/registry", dag.cacheVolume("cargo-registry"))
    .withMountedCache("/usr/local/cargo/git", dag.cacheVolume("cargo-git"))
    // Use separate target directories for cross-compilation to avoid conflicts
    .withEnvVariable("CARGO_TARGET_DIR", "/workspace/target-cross")
    .withMountedCache("/workspace/target-cross", dag.cacheVolume("clauderon-cross-target"))
    .withMountedDirectory("/workspace", source.directory("packages/clauderon"))
    // Enable multiarch for ARM64 packages
    .withExec(["dpkg", "--add-architecture", "arm64"])
    // Install cross-compilation dependencies, mold linker, and ARM64 OpenSSL
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y",
      "gcc-aarch64-linux-gnu",
      "libc6-dev-arm64-cross",
      "mold",
      "clang",
      "libssl-dev:arm64",
      "pkg-config",
      // binutils-aarch64-linux-gnu provides the aarch64 cross-linker (ld, ar, etc.)
      "binutils-aarch64-linux-gnu"
    ])
    // Add cross-compilation targets
    .withExec(["rustup", "target", "add", "x86_64-unknown-linux-gnu"])
    .withExec(["rustup", "target", "add", "aarch64-unknown-linux-gnu"]);

  // Only use sccache when S3 credentials are provided (avoid AWS metadata timeout)
  if (s3AccessKeyId && s3SecretAccessKey) {
    container = withSccache(container);
    container = container
      .withEnvVariable("RUSTC_WRAPPER", "sccache")
      .withEnvVariable("SCCACHE_BUCKET", "sccache")
      .withEnvVariable("SCCACHE_ENDPOINT", "https://seaweedfs.sjer.red")
      .withEnvVariable("SCCACHE_REGION", "us-east-1")
      .withSecretVariable("AWS_ACCESS_KEY_ID", s3AccessKeyId)
      .withSecretVariable("AWS_SECRET_ACCESS_KEY", s3SecretAccessKey);
  }

  return container;
}

/**
 * Build clauderon binary for a specific target
 */
async function _buildMuxBinary(
  container: Container,
  target: string,
  os: string,
  arch: string
): Promise<{ file: string; content: string }> {
  // Configure linker for cross-compilation
  let buildContainer = container;
  if (target === "aarch64-unknown-linux-gnu") {
    buildContainer = container
      .withEnvVariable("CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER", "aarch64-linux-gnu-gcc");
  }

  // Build the release binary
  buildContainer = buildContainer.withExec([
    "cargo", "build", "--release", "--target", target
  ]);

  // Get the binary
  const binaryPath = `/workspace/target-cross/${target}/release/clauderon`;
  const binary = await buildContainer.file(binaryPath).contents();

  const filename = `clauderon-${os}-${arch}`;
  return { file: filename, content: binary };
}

/**
 * Upload release assets to a GitHub release using proper binary file handling
 * @param githubToken GitHub token for authentication
 * @param version The release version (without 'v' prefix)
 * @param binariesDir Directory containing the built binaries
 * @param filenames List of filenames to upload
 */
async function uploadReleaseAssets(
  githubToken: Secret,
  version: string,
  binariesDir: Directory,
  filenames: string[]
): Promise<{ outputs: string[]; errors: string[] }> {
  const outputs: string[] = [];
  const errors: string[] = [];

  // Use gh CLI to upload assets - mount the binaries directory directly
  const container = dag
    .container()
    .from(`oven/bun:${BUN_VERSION}-debian`)
    .withMountedCache("/var/cache/apt", dag.cacheVolume(`apt-cache-bun-${BUN_VERSION}-debian`))
    .withMountedCache("/var/lib/apt", dag.cacheVolume(`apt-lib-bun-${BUN_VERSION}-debian`))
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "curl"])
    // Install GitHub CLI
    .withExec(["sh", "-c", "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg"])
    .withExec(["sh", "-c", 'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null'])
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "gh"])
    .withSecretVariable("GITHUB_TOKEN", githubToken)
    .withWorkdir("/workspace")
    // Mount binaries directory directly (preserves binary data)
    .withDirectory("/workspace/binaries", binariesDir);

  for (const filename of filenames) {
    // Upload to release
    try {
      await container
        .withExec([
          "gh", "release", "upload",
          `clauderon-v${version}`,
          `/workspace/binaries/${filename}`,
          "--repo", REPO_URL,
          "--clobber"
        ])
        .sync();
      outputs.push(`✓ Uploaded ${filename}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failureMsg = `Failed to upload ${filename}: ${errorMessage}`;
      outputs.push(`✗ ${failureMsg}`);
      errors.push(failureMsg);
    }
  }

  return { outputs, errors };
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
  const exitCodeMatch = /EXIT_CODE:(\d+)/.exec(lastLine);
  const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1] ?? "1", 10) : 1;
  const output = lines.slice(0, -1).join("\n");

  return {
    output: output || "(no output)",
    success: exitCode === 0,
  };
}

/**
 * Verify that non-exempt packages have required config files and scripts.
 * Runs as an inline shell script inside a container to check the source directory.
 */
function complianceCheck(source: Directory): Container {
  const script = `#!/bin/sh
set -e
ERRORS=0
for dir in /workspace/packages/*/; do
  PKG=$(basename "$dir")
  # Skip exempt packages
  case "$PKG" in
    resume|eslint-config|clauderon|claude-plugin|a2ui-poc|discord-claude|fonts|anki|castle-casters|macos-cross-compiler) continue ;;
  esac

  echo "Checking $PKG..."

  # Check for eslint config
  if ! ls "$dir"eslint.config.* >/dev/null 2>&1; then
    echo "  FAIL: $PKG missing eslint.config.*"
    ERRORS=$((ERRORS+1))
  fi

  # Check for lint script in package.json
  if ! grep -q '"lint"' "$dir/package.json" 2>/dev/null; then
    echo "  FAIL: $PKG missing lint script"
    ERRORS=$((ERRORS+1))
  fi

  # Check for typecheck script in package.json
  if ! grep -q '"typecheck"' "$dir/package.json" 2>/dev/null; then
    echo "  FAIL: $PKG missing typecheck script"
    ERRORS=$((ERRORS+1))
  fi

  # Check for tsconfig.json
  if [ ! -f "$dir/tsconfig.json" ]; then
    echo "  FAIL: $PKG missing tsconfig.json"
    ERRORS=$((ERRORS+1))
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo "Compliance check failed with $ERRORS error(s)"
  exit 1
fi
echo "All packages compliant"
`;

  return dag
    .container()
    .from("alpine:latest")
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withNewFile("/tmp/compliance.sh", script)
    .withExec(["sh", "/tmp/compliance.sh"]);
}

/**
 * Count lint/type suppressions and fail if they exceed the baseline.
 * Prevents suppression count from increasing over time (ratchet effect).
 */
function qualityRatchet(source: Directory): Container {
  const script = `#!/bin/sh
set -e

# Read baseline
BASELINE_ESLINT=$(grep -o '"eslint-disable": [0-9]*' /workspace/.quality-baseline.json | grep -o '[0-9]*')
BASELINE_TS=$(grep -o '"ts-suppressions": [0-9]*' /workspace/.quality-baseline.json | grep -o '[0-9]*')
BASELINE_RUST=$(grep -o '"rust-allow": [0-9]*' /workspace/.quality-baseline.json | grep -o '[0-9]*')
BASELINE_PRETTIER=$(grep -o '"prettier-ignore": [0-9]*' /workspace/.quality-baseline.json | grep -o '[0-9]*')

# Count current suppressions (excluding node_modules, dist, archive)
CURRENT_ESLINT=$(grep -r "eslint-disable" /workspace/packages/ /workspace/.dagger/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules | grep -v dist | grep -v archive | wc -l | tr -d ' ')
CURRENT_TS=$(grep -r "@ts-expect-error\\|@ts-ignore\\|@ts-nocheck" /workspace/packages/ /workspace/.dagger/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules | grep -v dist | grep -v archive | wc -l | tr -d ' ')
CURRENT_RUST=$(grep -r '#\\[allow(' /workspace/packages/clauderon/src/ --include="*.rs" 2>/dev/null | wc -l | tr -d ' ')
CURRENT_PRETTIER=$(grep -r "prettier-ignore" /workspace/packages/ /workspace/.dagger/ --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.css" --include="*.json" 2>/dev/null | grep -v node_modules | grep -v dist | grep -v archive | wc -l | tr -d ' ')

echo "Suppression counts (current / baseline):"
echo "  eslint-disable: $CURRENT_ESLINT / $BASELINE_ESLINT"
echo "  ts-suppressions: $CURRENT_TS / $BASELINE_TS"
echo "  rust-allow: $CURRENT_RUST / $BASELINE_RUST"
echo "  prettier-ignore: $CURRENT_PRETTIER / $BASELINE_PRETTIER"

FAILED=0
if [ "$CURRENT_ESLINT" -gt "$BASELINE_ESLINT" ]; then
  echo "FAIL: eslint-disable count increased ($CURRENT_ESLINT > $BASELINE_ESLINT)"
  FAILED=1
fi
if [ "$CURRENT_TS" -gt "$BASELINE_TS" ]; then
  echo "FAIL: ts-suppressions count increased ($CURRENT_TS > $BASELINE_TS)"
  FAILED=1
fi
if [ "$CURRENT_RUST" -gt "$BASELINE_RUST" ]; then
  echo "FAIL: rust-allow count increased ($CURRENT_RUST > $BASELINE_RUST)"
  FAILED=1
fi
if [ "$CURRENT_PRETTIER" -gt "$BASELINE_PRETTIER" ]; then
  echo "FAIL: prettier-ignore count increased ($CURRENT_PRETTIER > $BASELINE_PRETTIER)"
  FAILED=1
fi

if [ "$FAILED" -eq 1 ]; then
  echo "Quality ratchet failed. Update .quality-baseline.json if suppressions were intentionally added."
  exit 1
fi
echo "Quality ratchet passed"
`;

  return dag
    .container()
    .from("alpine:latest")
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withNewFile("/tmp/ratchet.sh", script)
    .withExec(["sh", "/tmp/ratchet.sh"]);
}

/**
 * Run shellcheck on all .sh files under packages/ and scripts/
 */
function shellcheckStep(source: Directory): Container {
  return dag
    .container()
    .from("koalaman/shellcheck:stable")
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withExec([
      "sh", "-c",
      "find /workspace/packages/ /workspace/scripts/ -name '*.sh' -not -path '*/node_modules/*' -print0 | xargs -0 -r shellcheck --severity=warning"
    ]);
}

/**
 * Run actionlint on GitHub Actions workflow files
 */
function actionlintStep(source: Directory): Container {
  return dag
    .container()
    .from("rhysd/actionlint:latest")
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withExec(["/actionlint", "-color"]);
}

/**
 * Run knip for dead code detection
 */
function knipCheck(container: Container): Container {
  return container.withExec(["bunx", "knip"]);
}

/**
 * Run Trivy filesystem scan for HIGH/CRITICAL vulnerabilities
 */
function trivyScan(source: Directory): Container {
  return dag
    .container()
    .from("aquasec/trivy:latest")
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withExec(["trivy", "fs", "--severity", "HIGH,CRITICAL", "--exit-code", "1", "."]);
}

/**
 * Run Semgrep security scan
 */
function semgrepScan(source: Directory): Container {
  return dag
    .container()
    .from("semgrep/semgrep:latest")
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withExec(["semgrep", "scan", "--config=auto", "--error"]);
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
    registryPassword?: Secret,
    s3AccessKeyId?: Secret,
    s3SecretAccessKey?: Secret
  ): Promise<string> {
    const outputs: string[] = [];
    const isRelease = branch === "main";

    // ============================================
    // VALIDATION PHASE (always runs - PRs + main)
    // ============================================

    // Compliance check (runs before install - uses lightweight alpine container)
    await complianceCheck(source).sync();
    outputs.push("✓ Compliance check");

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

    // Build clauderon web packages (requires special ordering due to TypeShare)
    outputs.push("\n--- Clauderon TypeScript Type Generation ---");

    // Step 1: Generate TypeScript types from Rust using typeshare
    // This must happen BEFORE building web packages since they import these types
    let rustContainer = getRustContainer(source, undefined, s3AccessKeyId, s3SecretAccessKey);
    // Install typeshare-cli and run it to generate types
    rustContainer = rustContainer
      .withExec(["cargo", "install", "typeshare-cli", "--locked"])
      .withExec(["typeshare", ".", "--lang=typescript", "--output-file=web/shared/src/generated/index.ts"]);
    await rustContainer.sync();
    outputs.push("✓ TypeScript types generated");

    // Step 2: Copy generated types to main container
    const generatedTypes = rustContainer.directory("/workspace/web/shared/src/generated");
    container = container
      .withDirectory("/workspace/packages/clauderon/web/shared/src/generated", generatedTypes);
    await container.sync();
    outputs.push("✓ Types copied to workspace");

    // Web workspace dependencies are already installed by the root bun install
    // (root package.json includes packages/clauderon/web/* as workspace members)
    outputs.push("\n--- Clauderon Web Packages ---");

    // Step 4: Build web packages in dependency order (now that types and deps exist)
    container = container
      .withWorkdir("/workspace/packages/clauderon/web/shared")
      .withExec(["bun", "run", "build"])
      .withWorkdir("/workspace/packages/clauderon/web/client")
      .withExec(["bun", "run", "build"])
      .withWorkdir("/workspace/packages/clauderon/web/frontend")
      .withExec(["bun", "run", "build"])
      .withWorkdir("/workspace");
    await container.sync();
    outputs.push("✓ Web packages built");

    // Extract the built frontend dist directory to pass to Rust build
    const frontendDist = container.directory("/workspace/packages/clauderon/web/frontend/dist");

    // Clauderon Rust validation (fmt, clippy, test, build)
    outputs.push("\n--- Clauderon Rust Validation ---");
    outputs.push(await this.clauderonCi(source, frontendDist, s3AccessKeyId, s3SecretAccessKey));

    // Now build remaining packages (web packages already built, will be skipped or fast)
    // Note: Skip tests here - bun-decompile tests fail in CI (requires `bun build --compile`)
    container = container.withExec(["bun", "run", "build"]);
    await container.sync();
    outputs.push("✓ Build");

    // Clauderon Mobile validation (React Native)
    outputs.push("\n--- Clauderon Mobile Validation ---");
    outputs.push(await this.mobileCi(source));

    // Birmel CI
    outputs.push("\n--- Birmel Validation ---");
    outputs.push(await checkBirmel(source));

    // Build birmel image ONCE and reuse for smoke test + publish
    const birmelImage = buildBirmelImage(source, version ?? "dev", gitSha ?? "dev");

    // Birmel smoke test (validates the built image starts correctly)
    outputs.push(await smokeTestBirmelImageWithContainer(birmelImage));

    // Quality & security checks
    outputs.push("\n--- Quality & Security Checks ---");

    // Quality ratchet (fail if suppression counts increased)
    await qualityRatchet(source).sync();
    outputs.push("✓ Quality ratchet");

    // Shellcheck
    try {
      await shellcheckStep(source).sync();
      outputs.push("✓ Shellcheck");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      outputs.push(`⚠ Shellcheck (non-blocking): ${msg}`);
    }

    // Actionlint
    try {
      await actionlintStep(source).sync();
      outputs.push("✓ Actionlint");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      outputs.push(`⚠ Actionlint (non-blocking): ${msg}`);
    }

    // Knip dead code detection
    try {
      await knipCheck(container).sync();
      outputs.push("✓ Knip");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      outputs.push(`⚠ Knip (non-blocking): ${msg}`);
    }

    // Security scans (non-blocking initially to establish baselines)
    try {
      await trivyScan(source).sync();
      outputs.push("✓ Trivy");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      outputs.push(`⚠ Trivy (non-blocking): ${msg}`);
    }

    try {
      await semgrepScan(source).sync();
      outputs.push("✓ Semgrep");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      outputs.push(`⚠ Semgrep (non-blocking): ${msg}`);
    }

    // ============================================
    // RELEASE PHASE (main only)
    // ============================================

    if (isRelease && githubToken && npmToken) {
      outputs.push("\n--- Release Workflow ---");
      const releaseErrors: string[] = [];

      // Create/update release PRs using non-deprecated release-pr command
      const prContainer = getReleasePleaseContainer()
        .withSecretVariable("GITHUB_TOKEN", githubToken);

      const prResult = await runReleasePleaseCommand(
        prContainer,
        `git clone https://x-access-token:$GITHUB_TOKEN@github.com/${REPO_URL}.git . && release-please release-pr --token=$GITHUB_TOKEN --repo-url=${REPO_URL} --target-branch=main`
      );

      outputs.push(`Release PR (success=${String(prResult.success)}):`);
      outputs.push(prResult.output);

      // Create GitHub releases using non-deprecated github-release command
      const releaseContainer = getReleasePleaseContainer()
        .withSecretVariable("GITHUB_TOKEN", githubToken);

      const releaseResult = await runReleasePleaseCommand(
        releaseContainer,
        `git clone https://x-access-token:$GITHUB_TOKEN@github.com/${REPO_URL}.git . && release-please github-release --token=$GITHUB_TOKEN --repo-url=${REPO_URL} --target-branch=main`
      );

      outputs.push(`GitHub Release (success=${String(releaseResult.success)}):`);
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
            const failureMsg = `Failed to publish @shepherdjerred/${pkg}: ${errorMessage}`;
            outputs.push(`✗ ${failureMsg}`);
            releaseErrors.push(failureMsg);
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

      // Deploy clauderon docs to S3
      if (s3AccessKeyId && s3SecretAccessKey) {
        outputs.push("\n--- Clauderon Docs Deployment ---");
        try {
          const deployOutput = await this.muxSiteDeploy(source, s3AccessKeyId, s3SecretAccessKey);
          outputs.push(deployOutput);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const failureMsg = `Failed to deploy clauderon docs: ${errorMessage}`;
          outputs.push(`✗ ${failureMsg}`);
          releaseErrors.push(failureMsg);
        }
      }

      // Deploy resume to S3
      if (s3AccessKeyId && s3SecretAccessKey) {
        outputs.push("\n--- Resume Deployment ---");
        try {
          const deployOutput = await this.resumeDeploy(source, s3AccessKeyId, s3SecretAccessKey);
          outputs.push(deployOutput);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const failureMsg = `Failed to deploy resume: ${errorMessage}`;
          outputs.push(`✗ ${failureMsg}`);
          releaseErrors.push(failureMsg);
        }
      }

      // Check if a clauderon release was created - only if we can extract a specific version
      const clauderonVersionMatch = /clauderon-v([\d.]+)/.exec(releaseResult.output);
      const clauderonVersion = clauderonVersionMatch?.[1];

      if (clauderonVersion) {
        outputs.push("\n--- Multiplexer Release ---");
        outputs.push(`Detected clauderon release: v${clauderonVersion}`);

        try {
          const binaries = this.multiplexerBuild(source, s3AccessKeyId, s3SecretAccessKey);

          // Get filenames for upload
          const linuxTargets = CLAUDERON_TARGETS.filter(t => t.os === "linux");
          const filenames = linuxTargets.map(({ os, arch }) => `clauderon-${os}-${arch}`);

          for (const filename of filenames) {
            outputs.push(`✓ Built ${filename}`);
          }

          // Upload to GitHub release (pass directory directly for proper binary handling)
          const uploadResults = await uploadReleaseAssets(githubToken, clauderonVersion, binaries, filenames);
          outputs.push(...uploadResults.outputs);
          releaseErrors.push(...uploadResults.errors);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const failureMsg = `Failed to build/upload clauderon binaries: ${errorMessage}`;
          outputs.push(`✗ ${failureMsg}`);
          releaseErrors.push(failureMsg);
        }
      } else {
        outputs.push("\nNo clauderon release detected - skipping binary upload");
      }

      // Fail CI if any release phase errors occurred
      if (releaseErrors.length > 0) {
        outputs.push(`\n--- Release Phase Failed ---`);
        outputs.push(`${String(releaseErrors.length)} error(s) occurred during release:`);
        releaseErrors.forEach((err, i) => outputs.push(`  ${String(i + 1)}. ${err}`));
        throw new Error(`Release phase failed with ${String(releaseErrors.length)} error(s):\n${releaseErrors.join("\n")}`);
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
   * Run Clauderon Mobile CI: lint, typecheck, format check, test
   * @param source The full workspace source directory
   */
  @func()
  async mobileCi(source: Directory): Promise<string> {
    const outputs: string[] = [];

    let container = dag
      .container()
      .from(`oven/bun:${BUN_VERSION}-debian`)
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
      .withWorkdir("/workspace")
      .withDirectory("/workspace", source.directory("packages/clauderon/mobile"))
      // Copy the shared generated types (mobile uses a symlink that doesn't work in isolation)
      .withDirectory(
        "/workspace/src/types/generated",
        source.directory("packages/clauderon/web/shared/src/generated")
      )
      // Copy the base tsconfig that mobile extends
      .withFile("/tsconfig.base.json", source.file("tsconfig.base.json"))
      .withExec(["bun", "install", "--frozen-lockfile"]);

    // Typecheck
    container = container.withExec(["bun", "run", "typecheck"]);
    await container.sync();
    outputs.push("✓ Mobile typecheck passed");

    // Lint
    container = container.withExec(["bun", "run", "lint"]);
    await container.sync();
    outputs.push("✓ Mobile lint passed");

    // Format check
    container = container.withExec(["bun", "run", "format:check"]);
    await container.sync();
    outputs.push("✓ Mobile format check passed");

    // Tests
    container = container.withExec(["bun", "run", "test"]);
    await container.sync();
    outputs.push("✓ Mobile tests passed");

    return outputs.join("\n");
  }

  /**
   * Run Clauderon CI: fmt check, clippy, test, build
   * @param source The full workspace source directory
   * @param frontendDist Optional pre-built frontend dist directory (required for cargo build)
   * @param s3AccessKeyId Optional S3 access key for sccache
   * @param s3SecretAccessKey Optional S3 secret key for sccache
   */
  @func()
  async clauderonCi(
    source: Directory,
    frontendDist?: Directory,
    s3AccessKeyId?: Secret,
    s3SecretAccessKey?: Secret
  ): Promise<string> {
    const outputs: string[] = [];

    let container = getRustContainer(source, frontendDist, s3AccessKeyId, s3SecretAccessKey);

    // Mount the built frontend if provided (required for Rust build - it embeds static files)
    if (frontendDist) {
      container = container.withMountedDirectory("/workspace/web/frontend/dist", frontendDist);
    }

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

    // cargo deny (license/advisory/ban checks)
    try {
      await container
        .withExec(["cargo", "install", "cargo-deny", "--locked"])
        .withExec(["cargo", "deny", "check"])
        .sync();
      outputs.push("✓ cargo deny passed");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      outputs.push(`⚠ cargo deny (non-blocking): ${msg}`);
    }

    // Compile tests without running (catches test compile issues)
    container = container.withExec(["cargo", "test", "--no-run"]);
    await container.sync();
    outputs.push("✓ Tests compiled");

    // Tests
    container = container.withExec(["cargo", "test"]);
    await container.sync();
    outputs.push("✓ Tests passed");

    // Coverage via cargo-llvm-cov
    try {
      await container
        .withExec(["cargo", "install", "cargo-llvm-cov", "--locked"])
        .withExec(["cargo", "llvm-cov", "--fail-under-lines", "40"])
        .sync();
      outputs.push("✓ Coverage threshold met");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      outputs.push(`⚠ Coverage (non-blocking): ${msg}`);
    }

    // Release build
    container = container.withExec(["cargo", "build", "--release"]);
    await container.sync();
    outputs.push("✓ Release build succeeded");

    return outputs.join("\n");
  }

  /**
   * Build clauderon binaries for Linux (x86_64 and ARM64)
   * Returns the built binaries as files
   * @param source The full workspace source directory
   * @param s3AccessKeyId Optional S3 access key for sccache
   * @param s3SecretAccessKey Optional S3 secret key for sccache
   */
  @func()
  multiplexerBuild(
    source: Directory,
    s3AccessKeyId?: Secret,
    s3SecretAccessKey?: Secret
  ): Directory {
    const container = getCrossCompileContainer(source, s3AccessKeyId, s3SecretAccessKey);

    // Build for Linux targets only (cross-compiling to macOS requires different tooling)
    const linuxTargets = CLAUDERON_TARGETS.filter(t => t.os === "linux");

    let outputContainer = dag.directory();

    for (const { target, os, arch } of linuxTargets) {
      let buildContainer = container;

      // Configure linker and OpenSSL for aarch64 cross-compilation
      if (target === "aarch64-unknown-linux-gnu") {
        // Override .cargo/config.toml to not use mold for aarch64 cross-compilation
        // (mold doesn't work well with cross-compilation toolchains)
        const cargoConfig = `
[registries.crates-io]
protocol = "sparse"

[build]
jobs = -1

[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=mold"]

[target.aarch64-unknown-linux-gnu]
linker = "aarch64-linux-gnu-gcc"
# No rustflags - use default linker (not mold)

[net]
retry = 3
`;
        buildContainer = container
          .withNewFile("/workspace/.cargo/config.toml", cargoConfig)
          // Point openssl-sys to the ARM64 OpenSSL installation
          .withEnvVariable("OPENSSL_DIR", "/usr")
          .withEnvVariable("OPENSSL_LIB_DIR", "/usr/lib/aarch64-linux-gnu")
          .withEnvVariable("OPENSSL_INCLUDE_DIR", "/usr/include")
          // Tell pkg-config to allow cross-compilation
          .withEnvVariable("PKG_CONFIG_ALLOW_CROSS", "1")
          .withEnvVariable("PKG_CONFIG_PATH", "/usr/lib/aarch64-linux-gnu/pkgconfig");
      }

      // Build the release binary
      buildContainer = buildContainer.withExec([
        "cargo", "build", "--release", "--target", target
      ]);

      // Get the binary and add to output directory
      const binaryPath = `/workspace/target-cross/${target}/release/clauderon`;
      const filename = `clauderon-${os}-${arch}`;
      outputContainer = outputContainer.withFile(filename, buildContainer.file(binaryPath));
    }

    return outputContainer;
  }

  /**
   * Full Multiplexer release: CI + build binaries + upload to GitHub release
   * @param source The full workspace source directory
   * @param version The version to release
   * @param githubToken GitHub token for uploading release assets
   * @param s3AccessKeyId Optional S3 access key for sccache
   * @param s3SecretAccessKey Optional S3 secret key for sccache
   */
  @func()
  async multiplexerRelease(
    source: Directory,
    version: string,
    githubToken: Secret,
    s3AccessKeyId?: Secret,
    s3SecretAccessKey?: Secret,
  ): Promise<string> {
    const outputs: string[] = [];

    // Run CI first
    outputs.push("--- Clauderon CI ---");
    outputs.push(await this.clauderonCi(source, undefined, s3AccessKeyId, s3SecretAccessKey));

    // Build binaries for Linux
    outputs.push("\n--- Building Binaries ---");
    const binaries = this.multiplexerBuild(source, s3AccessKeyId, s3SecretAccessKey);

    // Get filenames for upload
    const linuxTargets = CLAUDERON_TARGETS.filter(t => t.os === "linux");
    const filenames = linuxTargets.map(({ os, arch }) => `clauderon-${os}-${arch}`);

    for (const filename of filenames) {
      outputs.push(`✓ Built ${filename}`);
    }

    // Upload to GitHub release (pass directory directly for proper binary handling)
    outputs.push("\n--- Uploading to GitHub Release ---");
    const uploadResults = await uploadReleaseAssets(githubToken, version, binaries, filenames);
    outputs.push(...uploadResults.outputs);

    if (uploadResults.errors.length > 0) {
      throw new Error(`Failed to upload ${String(uploadResults.errors.length)} asset(s):\n${uploadResults.errors.join("\n")}`);
    }

    return outputs.join("\n");
  }

  /**
   * Build the clauderon docs site
   */
  @func()
  muxSiteBuild(source: Directory): Container {
    return dag
      .container()
      .from(`oven/bun:${BUN_VERSION}-debian`)
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
      .withWorkdir("/workspace")
      .withDirectory("/workspace", source.directory("packages/clauderon/docs"))
      .withExec(["bun", "install"])
      .withExec(["bun", "run", "build"]);
  }

  /**
   * Get the built clauderon docs as a directory
   */
  @func()
  muxSiteOutput(source: Directory): Directory {
    const container = this.muxSiteBuild(source);
    return container.directory("/workspace/dist");
  }

  /**
   * Deploy clauderon docs to SeaweedFS S3
   */
  @func()
  async muxSiteDeploy(
    source: Directory,
    s3AccessKeyId: Secret,
    s3SecretAccessKey: Secret,
  ): Promise<string> {
    const outputs: string[] = [];

    // Build the site
    const siteDir = this.muxSiteOutput(source);
    outputs.push("✓ Built clauderon docs");

    // Deploy to SeaweedFS S3
    const syncOutput = await syncToS3({
      sourceDir: siteDir,
      bucketName: "clauderon",
      endpointUrl: "https://seaweedfs.sjer.red",
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      region: "us-east-1",
      deleteRemoved: true,
    });

    outputs.push("✓ Deployed to SeaweedFS S3 (bucket: clauderon)");
    outputs.push(syncOutput);

    return outputs.join("\n");
  }

  /**
   * Build the resume PDF from LaTeX source.
   */
  @func()
  resumeBuild(source: Directory): File {
    return dag
      .container()
      .from(LATEX_IMAGE)
      .withMountedDirectory("/workspace", source.directory("packages/resume"))
      .withWorkdir("/workspace")
      .withExec(["pdflatex", "resume.tex"])
      .file("/workspace/resume.pdf");
  }

  /**
   * Get resume output directory (PDF + HTML) for deployment.
   */
  @func()
  resumeOutput(source: Directory): Directory {
    const pdf = this.resumeBuild(source);
    const resumeDir = source.directory("packages/resume");
    return dag
      .directory()
      .withFile("resume.pdf", pdf)
      .withFile("index.html", resumeDir.file("index.html"));
  }

  /**
   * Deploy resume to SeaweedFS S3.
   */
  @func()
  async resumeDeploy(
    source: Directory,
    s3AccessKeyId: Secret,
    s3SecretAccessKey: Secret,
  ): Promise<string> {
    const outputs: string[] = [];
    const outputDir = this.resumeOutput(source);
    outputs.push("✓ Built resume.pdf");

    const syncOutput = await syncToS3({
      sourceDir: outputDir,
      bucketName: "resume",
      endpointUrl: "https://seaweedfs.sjer.red",
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      region: "us-east-1",
      deleteRemoved: true,
    });

    outputs.push("✓ Deployed to SeaweedFS S3 (bucket: resume)");
    outputs.push(syncOutput);
    return outputs.join("\n");
  }

  /**
   * Run automatic code review on a PR.
   * Analyzes PR complexity, runs Claude review, and posts approval/request-changes.
   *
   * @param source - Source directory with git repo
   * @param githubToken - GitHub token for posting reviews
   * @param claudeOauthToken - Claude Code OAuth token
   * @param prNumber - PR number to review
   * @param baseBranch - Base branch (e.g., "main")
   * @param headSha - Head commit SHA
   */
  @func()
  async codeReview(
    source: Directory,
    githubToken: Secret,
    claudeOauthToken: Secret,
    prNumber: number,
    baseBranch: string,
    headSha: string,
  ): Promise<string> {
    return reviewPr({
      source,
      githubToken,
      claudeOauthToken,
      prNumber,
      baseBranch,
      headSha,
    });
  }

  /**
   * Handle interactive @claude mention in a PR comment.
   *
   * @param source - Source directory with git repo
   * @param githubToken - GitHub token for posting comments
   * @param claudeOauthToken - Claude Code OAuth token
   * @param prNumber - PR number
   * @param commentBody - The comment text (as Secret to support env: prefix)
   * @param commentPath - Optional file path for review comments
   * @param commentLine - Optional line number for review comments
   * @param commentDiffHunk - Optional diff context for review comments
   */
  @func()
  async codeReviewInteractive(
    source: Directory,
    githubToken: Secret,
    claudeOauthToken: Secret,
    prNumber: number,
    commentBody: Secret,
    commentPath?: string,
    commentLine?: number,
    commentDiffHunk?: string,
  ): Promise<string> {
    // Extract comment body from secret
    // Note: In Dagger, we need to handle secrets carefully
    // The commentBody is passed as Secret so env: prefix works in GHA
    const bodyText = await commentBody.plaintext();

    return handleInteractive({
      source,
      githubToken,
      claudeOauthToken,
      prNumber,
      commentBody: bodyText,
      eventContext: commentPath
        ? {
            path: commentPath,
            line: commentLine,
            diffHunk: commentDiffHunk,
          }
        : undefined,
    });
  }
}
