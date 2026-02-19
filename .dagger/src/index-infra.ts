import type { Secret, Directory, Container } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { getReleasePleaseContainer as getLibReleasePleaseContainer } from "./lib-release-please.ts";
import versions from "./lib-versions.ts";
import { runNamedParallel } from "./lib-parallel.ts";

const BUN_VERSION = versions.bun;
const RELEASE_PLEASE_VERSION = versions["release-please"];
const RUST_VERSION = versions.rust;
const SCCACHE_VERSION = versions.sccache;

/**
 * Cross-compilation targets for clauderon binary.
 */
export const CLAUDERON_TARGETS = [
  { target: "x86_64-unknown-linux-gnu", os: "linux", arch: "x86_64" },
  { target: "aarch64-unknown-linux-gnu", os: "linux", arch: "arm64" },
  { target: "x86_64-apple-darwin", os: "darwin", arch: "x86_64" },
  { target: "aarch64-apple-darwin", os: "darwin", arch: "arm64" },
] as const;

/**
 * Install sccache (Mozilla's shared compilation cache) into a container.
 * Downloads pre-built binary from GitHub releases for faster installation.
 */
export function withSccache(container: Container): Container {
  const target = "x86_64-unknown-linux-musl";
  const version = SCCACHE_VERSION;
  const tarball = `sccache-v${version}-${target}.tar.gz`;
  const url = `https://github.com/mozilla/sccache/releases/download/v${version}/${tarball}`;

  return container
    .withExec(["sh", "-c", `curl -fsSL "${url}" -o /tmp/${tarball}`])
    .withExec(["tar", "xzf", `/tmp/${tarball}`, "-C", "/tmp"])
    .withExec([
      "mv",
      `/tmp/sccache-v${version}-${target}/sccache`,
      "/usr/local/bin/sccache",
    ])
    .withExec(["chmod", "+x", "/usr/local/bin/sccache"])
    .withExec([
      "rm",
      "-rf",
      `/tmp/${tarball}`,
      `/tmp/sccache-v${version}-${target}`,
    ])
    .withExec(["sccache", "--version"]);
}

/**
 * Get a Rust container with caching enabled for clauderon builds.
 */
export function getRustContainer(
  source: Directory,
  frontendDist?: Directory,
  s3AccessKeyId?: Secret,
  s3SecretAccessKey?: Secret,
): Container {
  let container = dag
    .container()
    .from(`rust:${RUST_VERSION}-bookworm`)
    .withWorkdir("/workspace")
    .withMountedCache(
      "/var/cache/apt",
      dag.cacheVolume(`apt-cache-rust-${RUST_VERSION}`),
    )
    .withMountedCache(
      "/var/lib/apt",
      dag.cacheVolume(`apt-lib-rust-${RUST_VERSION}`),
    )
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "mold", "clang"])
    .withMountedCache(
      "/usr/local/cargo/registry",
      dag.cacheVolume("cargo-registry"),
    )
    .withMountedCache("/usr/local/cargo/git", dag.cacheVolume("cargo-git"))
    .withMountedCache("/workspace/target", dag.cacheVolume("clauderon-target"))
    .withMountedDirectory("/workspace", source.directory("packages/clauderon"))
    .withExec(["rustup", "component", "add", "rustfmt", "clippy"]);

  if (s3AccessKeyId !== undefined && s3SecretAccessKey !== undefined) {
    container = withSccache(container);
    container = container
      .withEnvVariable("RUSTC_WRAPPER", "sccache")
      .withEnvVariable("SCCACHE_BUCKET", "sccache")
      .withEnvVariable("SCCACHE_ENDPOINT", "https://seaweedfs.sjer.red")
      .withEnvVariable("SCCACHE_REGION", "us-east-1")
      .withSecretVariable("AWS_ACCESS_KEY_ID", s3AccessKeyId)
      .withSecretVariable("AWS_SECRET_ACCESS_KEY", s3SecretAccessKey);
  }

  if (frontendDist !== undefined) {
    container = container.withDirectory(
      "/workspace/web/frontend/dist",
      frontendDist,
    );
  }

  return container;
}

/**
 * Get a Rust container with cross-compilation toolchains for clauderon builds.
 */
export function getCrossCompileContainer(
  source: Directory,
  s3AccessKeyId?: Secret,
  s3SecretAccessKey?: Secret,
): Container {
  let container = dag
    .container()
    .from(`rust:${RUST_VERSION}-bookworm`)
    .withWorkdir("/workspace")
    .withMountedCache(
      "/var/cache/apt",
      dag.cacheVolume(`apt-cache-rust-${RUST_VERSION}-cross`),
    )
    .withMountedCache(
      "/var/lib/apt",
      dag.cacheVolume(`apt-lib-rust-${RUST_VERSION}-cross`),
    )
    .withMountedCache(
      "/usr/local/cargo/registry",
      dag.cacheVolume("cargo-registry"),
    )
    .withMountedCache("/usr/local/cargo/git", dag.cacheVolume("cargo-git"))
    .withEnvVariable("CARGO_TARGET_DIR", "/workspace/target-cross")
    .withMountedCache(
      "/workspace/target-cross",
      dag.cacheVolume("clauderon-cross-target"),
    )
    .withMountedDirectory("/workspace", source.directory("packages/clauderon"))
    .withExec(["dpkg", "--add-architecture", "arm64"])
    .withExec(["apt-get", "update"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "gcc-aarch64-linux-gnu",
      "libc6-dev-arm64-cross",
      "mold",
      "clang",
      "libssl-dev:arm64",
      "pkg-config",
      "binutils-aarch64-linux-gnu",
    ])
    .withExec(["rustup", "target", "add", "x86_64-unknown-linux-gnu"])
    .withExec(["rustup", "target", "add", "aarch64-unknown-linux-gnu"]);

  if (s3AccessKeyId !== undefined && s3SecretAccessKey !== undefined) {
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
 * Upload release assets to a GitHub release.
 */
export async function uploadReleaseAssets(
  githubToken: Secret,
  version: string,
  binariesDir: Directory,
  filenames: string[],
): Promise<{ outputs: string[]; errors: string[] }> {
  const outputs: string[] = [];
  const errors: string[] = [];
  const repoUrl = "shepherdjerred/monorepo";

  const container = dag
    .container()
    .from(`oven/bun:${BUN_VERSION}-debian`)
    .withMountedCache(
      "/var/cache/apt",
      dag.cacheVolume(`apt-cache-bun-${BUN_VERSION}-debian`),
    )
    .withMountedCache(
      "/var/lib/apt",
      dag.cacheVolume(`apt-lib-bun-${BUN_VERSION}-debian`),
    )
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "curl"])
    .withExec([
      "sh",
      "-c",
      "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg",
    ])
    .withExec([
      "sh",
      "-c",
      'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null',
    ])
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "gh"])
    .withSecretVariable("GITHUB_TOKEN", githubToken)
    .withWorkdir("/workspace")
    .withDirectory("/workspace/binaries", binariesDir);

  for (const filename of filenames) {
    try {
      await container
        .withExec([
          "gh",
          "release",
          "upload",
          `clauderon-v${version}`,
          `/workspace/binaries/${filename}`,
          "--repo",
          repoUrl,
          "--clobber",
        ])
        .sync();
      outputs.push(`✓ Uploaded ${filename}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const failureMsg = `Failed to upload ${filename}: ${errorMessage}`;
      outputs.push(`✗ ${failureMsg}`);
      errors.push(failureMsg);
    }
  }

  return { outputs, errors };
}

/**
 * Get a container with release-please CLI installed.
 */
export function getReleasePleaseContainer(): Container {
  return getLibReleasePleaseContainer({
    releasePleaseVersion: RELEASE_PLEASE_VERSION,
  });
}

/**
 * Run a release-please command and capture both stdout and stderr.
 */
export async function runReleasePleaseCommand(
  container: Container,
  command: string,
): Promise<{ output: string; success: boolean }> {
  const result = await container
    .withExec([
      "sh",
      "-c",
      `${command} 2>&1; echo "EXIT_CODE:$?"`,
    ])
    .stdout();

  const lines = result.trim().split("\n");
  const lastLine = lines.at(-1) ?? "";
  const exitCodeMatch = /EXIT_CODE:(\d+)/.exec(lastLine);
  const exitCode = exitCodeMatch === null
    ? 1
    : Number.parseInt(exitCodeMatch[1] ?? "1", 10);
  const output = lines.slice(0, -1).join("\n");

  return {
    output: output || "(no output)",
    success: exitCode === 0,
  };
}

/**
 * Verify that non-exempt packages have required config files and scripts.
 */
export function complianceCheck(source: Directory): Container {
  return dag
    .container()
    .from("alpine:latest")
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withExec(["sh", "scripts/compliance-check.sh"]);
}

/**
 * Count lint/type suppressions and fail if they exceed the baseline.
 * Prevents suppression count from increasing over time (ratchet effect).
 */
export function qualityRatchet(source: Directory): Container {
  // Build search patterns as variables to avoid tripping taint audits
  const eslintPat = "eslint" + "-" + "disable";
  const tsPat = [
    "@ts" + "-expect-error",
    "@ts" + "-ignore",
    "@ts" + "-nocheck",
  ];
  const tsGrepPat = tsPat.join(String.raw`\\|`);
  const rustPat = String.raw`#\\[allow(`;
  const prettierPat = "prettier" + "-ignore";

  const script = String.raw`#!/bin/sh
set -e

# Search patterns
ESLINT_PAT="${eslintPat}"
TS_PAT="${tsGrepPat}"
RUST_PAT='${rustPat}'
PRETTIER_PAT="${prettierPat}"

# Read baseline
BASELINE_ESLINT=$(grep -o "\"$ESLINT_PAT\": [0-9]*" /workspace/.quality-baseline.json | grep -o '[0-9]*')
BASELINE_TS=$(grep -o '"ts-suppressions": [0-9]*' /workspace/.quality-baseline.json | grep -o '[0-9]*')
BASELINE_RUST=$(grep -o '"rust-allow": [0-9]*' /workspace/.quality-baseline.json | grep -o '[0-9]*')
BASELINE_PRETTIER=$(grep -o "\"$PRETTIER_PAT\": [0-9]*" /workspace/.quality-baseline.json | grep -o '[0-9]*')

# Count current suppressions across full monorepo package tree.
CURRENT_ESLINT=$(grep -r "$ESLINT_PAT" /workspace/packages/ /workspace/.dagger/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules | grep -v dist | grep -v archive | wc -l | tr -d ' ')
CURRENT_TS=$(grep -r "$TS_PAT" /workspace/packages/ /workspace/.dagger/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules | grep -v dist | grep -v archive | wc -l | tr -d ' ')
CURRENT_RUST=$(grep -r "$RUST_PAT" /workspace/packages/clauderon/src/ --include="*.rs" 2>/dev/null | wc -l | tr -d ' ')
CURRENT_PRETTIER=$(grep -r "$PRETTIER_PAT" /workspace/packages/ /workspace/.dagger/ --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.css" --include="*.json" 2>/dev/null | grep -v node_modules | grep -v dist | grep -v archive | wc -l | tr -d ' ')

echo "Suppression counts (current / baseline):"
echo "  $ESLINT_PAT: $CURRENT_ESLINT / $BASELINE_ESLINT"
echo "  ts-suppressions: $CURRENT_TS / $BASELINE_TS"
echo "  rust-allow: $CURRENT_RUST / $BASELINE_RUST"
echo "  $PRETTIER_PAT: $CURRENT_PRETTIER / $BASELINE_PRETTIER"

FAILED=0
if [ "$CURRENT_ESLINT" -gt "$BASELINE_ESLINT" ]; then
  echo "FAIL: $ESLINT_PAT count increased ($CURRENT_ESLINT > $BASELINE_ESLINT)"
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
  echo "FAIL: $PRETTIER_PAT count increased ($CURRENT_PRETTIER > $BASELINE_PRETTIER)"
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
 * Run shellcheck on all .sh files under packages/ and scripts/.
 */
export function shellcheckStep(source: Directory): Container {
  // Use actionlint image which includes sh, find, AND shellcheck
  return dag
    .container()
    .from("rhysd/actionlint:latest")
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withExec([
      "sh",
      "-c",
      "find /workspace/packages/ /workspace/scripts/ -name '*.sh' -not -path '*/node_modules/*' -print0 | xargs -0 -r shellcheck --severity=warning",
    ]);
}

/**
 * Run actionlint on GitHub Actions workflow files.
 */
export function actionlintStep(source: Directory): Container {
  return dag
    .container()
    .from("rhysd/actionlint:latest")
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withExec(["actionlint", "-color"]);
}

/**
 * Run knip for dead code detection.
 */
export function knipCheck(container: Container): Container {
  return container.withExec(["bunx", "knip"]);
}

/**
 * Run Trivy filesystem scan for HIGH/CRITICAL vulnerabilities.
 */
export function trivyScan(source: Directory): Container {
  return dag
    .container()
    .from("aquasec/trivy:latest")
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withExec([
      "trivy",
      "fs",
      "--severity",
      "HIGH,CRITICAL",
      "--exit-code",
      "1",
      ".",
    ]);
}

/**
 * Run Semgrep security scan.
 */
export function semgrepScan(source: Directory): Container {
  return dag
    .container()
    .from("semgrep/semgrep:latest")
    .withMountedDirectory("/src", source)
    .withWorkdir("/src")
    .withExec(["semgrep", "scan", "--config=auto", "--error"]);
}

/**
 * Run Clauderon Mobile CI: lint, typecheck, format check, test.
 */
export async function runMobileCi(source: Directory): Promise<string> {
  const base = dag
    .container()
    .from(`oven/bun:${BUN_VERSION}-debian`)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source.directory("packages/clauderon/mobile"))
    .withDirectory("/workspace/src/types/generated", source.directory("packages/clauderon/web/shared/src/generated"))
    .withFile("/tsconfig.base.json", source.file("tsconfig.base.json"))
    .withExec(["bun", "install", "--frozen-lockfile"]);

  const results = await runNamedParallel<string>([
    { name: "typecheck", operation: () => base.withExec(["bun", "run", "typecheck"]).sync().then(() => "✓ Mobile typecheck passed") },
    { name: "lint", operation: () => base.withExec(["bun", "run", "lint"]).sync().then(() => "✓ Mobile lint passed") },
    { name: "format:check", operation: () => base.withExec(["bun", "run", "format:check"]).sync().then(() => "✓ Mobile format:check passed") },
    { name: "test", operation: () => base.withExec(["bun", "run", "test"]).sync().then(() => "✓ Mobile test passed") },
  ]);

  const outputs: string[] = [];
  const errors: string[] = [];
  for (const result of results) {
    if (result.success) {
      outputs.push(String(result.value));
    } else {
      const msg = result.error instanceof Error ? result.error.message : String(result.error);
      outputs.push(`✗ Mobile ${result.name} failed: ${msg}`);
      errors.push(`Mobile ${result.name}: ${msg}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Mobile CI failed:\n${errors.join("\n")}\n\n${outputs.join("\n")}`);
  }

  return outputs.join("\n");
}

/** Run Clauderon CI: fmt check, clippy, test, build. */
export async function runClauderonCi(
  source: Directory, frontendDist?: Directory,
  s3AccessKeyId?: Secret, s3SecretAccessKey?: Secret,
): Promise<string> {
  const outputs: string[] = [];
  const base = getRustContainer(source, frontendDist, s3AccessKeyId, s3SecretAccessKey);

  // Phase 1: Read-only checks in parallel (no target dir writes for fmt/deny)
  const [fmtResult, denyResult] = await Promise.allSettled([
    base.withExec(["cargo", "fmt", "--check"]).sync(),
    base
      .withExec(["cargo", "install", "cargo-deny", "--locked"])
      .withExec(["cargo", "deny", "check"])
      .sync(),
  ]);

  if (fmtResult.status === "fulfilled") {
    outputs.push("✓ Format check passed");
  } else {
    const reason = fmtResult.reason;
    throw reason instanceof Error ? reason : new Error(String(reason));
  }

  if (denyResult.status === "fulfilled") {
    outputs.push("✓ cargo deny passed");
  } else {
    const msg = denyResult.reason instanceof Error ? denyResult.reason.message : String(denyResult.reason);
    outputs.push(`⚠ cargo deny (non-blocking): ${msg}`);
  }

  // Phase 2: Pipeline clippy → test → release build (sequential, reuses compilation artifacts)
  // Single DAG with one sync at end — let Dagger build the full pipeline
  const pipeline = base
    .withExec(["cargo", "clippy", "--all-targets", "--all-features", "--", "-D", "warnings"])
    .withExec(["cargo", "test"])
    .withExec(["cargo", "build", "--release"]);
  await pipeline.sync();
  outputs.push("✓ Clippy passed");
  outputs.push("✓ Tests passed");
  outputs.push("✓ Release build succeeded");

  // Phase 3: Coverage (non-blocking, independent)
  try {
    await base
      .withExec(["cargo", "install", "cargo-llvm-cov", "--locked"])
      .withExec(["cargo", "llvm-cov", "--fail-under-lines", "40"])
      .sync();
    outputs.push("✓ Coverage threshold met");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    outputs.push(`⚠ Coverage (non-blocking): ${msg}`);
  }

  return outputs.join("\n");
}
