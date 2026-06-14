/**
 * Homelab operation helper functions (cdk8s synth).
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { Container, Directory, File } from "@dagger.io/dagger";

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
