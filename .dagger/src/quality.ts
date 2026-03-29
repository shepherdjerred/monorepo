/**
 * Quality gate helper functions for repo-wide checks.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory } from "@dagger.io/dagger";

// renovate: datasource=docker depName=oven/bun
const BUN_IMAGE = "oven/bun:1.2.17-debian";

// renovate: datasource=docker depName=zricethezav/gitleaks
const GITLEAKS_IMAGE = "zricethezav/gitleaks:v8.22.1";

const BUN_CACHE = "bun-install-cache";

const SOURCE_EXCLUDES = [
  "**/node_modules",
  "**/.eslintcache",
  "**/dist",
  "**/target",
  ".git",
  "**/.vscode",
  "**/.idea",
  "**/coverage",
  "**/build",
  "**/.next",
  "**/.tsbuildinfo",
  "**/__pycache__",
  "**/.DS_Store",
  "**/archive",
];

/**
 * Create a bun container with source mounted, workdir at /workspace.
 * Quality scripts use bun builtins and bunx — no npm install needed.
 */
function bunContainer(source: Directory): Container {
  return dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source, {
      exclude: SOURCE_EXCLUDES,
    });
}

/** Run the quality ratchet script and return its output. */
export function qualityRatchetHelper(source: Directory): Container {
  return bunContainer(source).withExec(["bun", "scripts/quality-ratchet.ts"]);
}

/** Run the compliance check shell script and return its output. */
export function complianceCheckHelper(source: Directory): Container {
  return bunContainer(source).withExec(["bash", "scripts/compliance-check.sh"]);
}

/** Run knip to detect unused code and return its output. */
export function knipCheckHelper(source: Directory): Container {
  return bunContainer(source)
    .withExec(["bun", "install"])
    .withExec(["bunx", "knip", "--no-exit-code", "--no-config-hints"]);
}

/** Run gitleaks to detect secrets in the source tree. */
export function gitleaksCheckHelper(source: Directory): Container {
  return dag
    .container()
    .from(GITLEAKS_IMAGE)
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source, {
      exclude: SOURCE_EXCLUDES,
    })
    .withExec(["gitleaks", "detect", "--source", "/workspace", "--no-git"]);
}

/** Run the suppression check script and return its output. */
export function suppressionCheckHelper(source: Directory): Container {
  return bunContainer(source)
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "git",
    ])
    .withExec(["bun", "scripts/check-suppressions.ts", "--ci"]);
}
