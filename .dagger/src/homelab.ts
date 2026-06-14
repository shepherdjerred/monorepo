/**
 * Homelab operation helper functions (cdk8s synth, helm-types drift check, 1Password lint).
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory, File } from "@dagger.io/dagger";

import { HELM_IMAGE } from "./constants";
import { bunBaseContainer } from "./base";

/** Run cdk8s synth (bun run build) and return the output directory. */
export function homelabSynthHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Directory {
  return bunBaseContainer(
    pkgDir,
    "homelab/src/cdk8s",
    depNames,
    depDirs,
    tsconfig,
  )
    .withExec(["bun", "run", "build"])
    .directory("/workspace/packages/homelab/src/cdk8s/dist");
}

/**
 * Regenerate the committed cdk8s Helm value types and fail if they drift from
 * what is checked in. `generate-helm-types --check` re-fetches every chart in
 * `src/versions.ts` (so it needs the helm CLI, copied in from the pinned
 * HELM_IMAGE like `testHelper` does) and compares the freshly generated tree
 * against the committed `generated/helm/`, exiting non-zero on any difference.
 *
 * This is the CI freshness gate that replaced the weekly helm-types-refresh
 * Temporal workflow: a chart-version bump (or generator/lib change) that isn't
 * accompanied by `bun run generate-helm-types` now fails CI instead of waiting
 * for an out-of-band reconcile PR.
 */
export function helmTypesDriftCheckHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Container {
  const helmBinary = dag.container().from(HELM_IMAGE).file("/usr/bin/helm");
  return bunBaseContainer(
    pkgDir,
    "homelab/src/cdk8s",
    depNames,
    depDirs,
    tsconfig,
  )
    .withFile("/usr/local/bin/helm", helmBinary)
    .withExec(["bun", "run", "generate-helm-types", "--check"]);
}

/**
 * Lint that every cdk8s `OnePasswordItem` reference and every consumed secret field
 * exists in the committed vault snapshot (`onepassword-vault-snapshot.json`). Fully
 * offline — synthesizes in-memory and checks against the snapshot, no 1Password access.
 * Reuses the same prepared cdk8s workspace as `homelabSynthHelper`.
 */
export function homelabOnePasswordLintHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Container {
  return bunBaseContainer(
    pkgDir,
    "homelab/src/cdk8s",
    depNames,
    depDirs,
    tsconfig,
  ).withExec(["bun", "run", "scripts/check-1password-items.ts"]);
}
