/**
 * Homelab operation helper functions (cdk8s synth).
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { Directory, File } from "@dagger.io/dagger";

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
