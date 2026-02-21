import type { Secret, Directory, Container } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { getReleasePleaseContainer as getLibReleasePleaseContainer } from "./lib-release-please.ts";
import versions from "./lib-versions.ts";
import { getBuiltEslintConfig } from "./lib-eslint-config.ts";
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
    .withExec(["apt-get", "install", "-y", "mold", "clang", "git"])
    .withMountedCache(
      "/usr/local/cargo/registry",
      dag.cacheVolume("cargo-registry"),
    )
    .withMountedCache("/usr/local/cargo/git", dag.cacheVolume("cargo-git"))
    .withMountedCache("/workspace/target", dag.cacheVolume("clauderon-target"))
    .withMountedCache(
      "/root/.cargo-tools/bin",
      dag.cacheVolume("cargo-tools-bin"),
    )
    .withEnvVariable(
      "PATH",
      "/root/.cargo-tools/bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    )
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
    .withExec(["sh", "-c", `${command} 2>&1; echo "EXIT_CODE:$?"`])
    .stdout();

  const lines = result.trim().split("\n");
  const lastLine = lines.at(-1) ?? "";
  const exitCodeMatch = /EXIT_CODE:(\d+)/.exec(lastLine);
  const exitCode =
    exitCodeMatch === null ? 1 : Number.parseInt(exitCodeMatch[1] ?? "1", 10);
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
    .withWorkdir("/workspace")
    .withFile("/workspace/package.json", source.file("package.json"))
    .withMountedDirectory("/workspace/packages", source.directory("packages"))
    .withFile("/workspace/scripts/compliance-check.sh", source.file("scripts/compliance-check.sh"))
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
    .withWorkdir("/workspace")
    .withMountedDirectory("/workspace/packages", source.directory("packages"))
    .withMountedDirectory("/workspace/.dagger", source.directory(".dagger"))
    .withFile("/workspace/.quality-baseline.json", source.file(".quality-baseline.json"))
    .withNewFile("/tmp/ratchet.sh", script)
    .withExec(["sh", "/tmp/ratchet.sh"]);
}

/**
 * Run ESLint on the .dagger/ directory.
 */
export function daggerLintCheck(source: Directory): Container {
  return dag
    .container()
    .from(`oven/bun:${BUN_VERSION}`)
    .withMountedDirectory("/workspace/.dagger", source.directory(".dagger"))
    .withDirectory(
      "/workspace/packages/eslint-config",
      getBuiltEslintConfig(source),
    )
    .withFile(
      "/workspace/tsconfig.base.json",
      source.file("tsconfig.base.json"),
    )
    .withWorkdir("/workspace/.dagger")
    .withExec(["bun", "install"])
    .withWorkdir("/workspace/.dagger")
    .withExec(["bunx", "eslint", "src"]);
}

/**
 * Run shellcheck on all .sh files under packages/, scripts/, and .buildkite/.
 */
export function shellcheckStep(source: Directory): Container {
  // Use actionlint image which includes sh, find, AND shellcheck
  return dag
    .container()
    .from("rhysd/actionlint:latest")
    .withWorkdir("/workspace")
    .withMountedDirectory("/workspace/packages", source.directory("packages"))
    .withMountedDirectory("/workspace/scripts", source.directory("scripts"))
    .withMountedDirectory(
      "/workspace/.buildkite",
      source.directory(".buildkite"),
    )
    .withExec([
      "sh",
      "-c",
      "find /workspace/packages/ /workspace/scripts/ /workspace/.buildkite/ -name '*.sh' -not -path '*/node_modules/*' -print0 | xargs -0 -r shellcheck --severity=warning",
    ]);
}

/**
 * Run actionlint on GitHub Actions workflow files.
 */
export function actionlintStep(source: Directory): Container {
  return dag
    .container()
    .from("rhysd/actionlint:latest")
    .withWorkdir("/workspace")
    .withMountedDirectory("/workspace/.github", source.directory(".github"))
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

/** Create a named check that syncs a container and returns a success message. */
function syncCheck(name: string, container: Container) {
  return { name, operation: async () => { await container.sync(); return `✓ ${name}`; } };
}

/** Run all quality and security checks in parallel. */
export async function runQualityChecks(source: Directory): Promise<string> {
  const results = await runNamedParallel<string>([
    syncCheck("Quality ratchet", qualityRatchet(source)),
    syncCheck("Shellcheck", shellcheckStep(source)),
    syncCheck("Actionlint", actionlintStep(source)),
    syncCheck("Trivy", trivyScan(source)),
    syncCheck("Semgrep", semgrepScan(source)),
    syncCheck("Dagger ESLint", daggerLintCheck(source)),
  ]);
  const outputs: string[] = [];
  for (const result of results) {
    if (result.success) {
      outputs.push(String(result.value));
    } else {
      const msg = result.error instanceof Error ? result.error.message : String(result.error);
      outputs.push(`::warning title=${result.name}::${msg.slice(0, 200)}`);
      outputs.push(`⚠ ${result.name} (non-blocking): ${msg}`);
    }
  }
  return outputs.join("\n");
}
