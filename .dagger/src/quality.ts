/**
 * Quality gate helper functions for repo-wide checks.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory } from "@dagger.io/dagger";

import {
  BUN_IMAGE,
  GITLEAKS_IMAGE,
  BUN_CACHE,
  SOURCE_EXCLUDES,
} from "./constants";

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
    .withExec([
      "bash",
      "-c",
      'for dir in $(find packages/ -name bun.lock -not -path "*/node_modules/*" -not -path "*/example/*" | xargs -I{} dirname {}); do (cd "$dir" && bun install --frozen-lockfile); done',
    ])
    .withExec(["bunx", "knip", "--no-config-hints"]);
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

/** Run the dagger hygiene checker and return its output. */
export function daggerHygieneHelper(source: Directory): Container {
  return bunContainer(source).withExec([
    "bun",
    "scripts/check-dagger-hygiene.ts",
  ]);
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
