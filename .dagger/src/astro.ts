/**
 * Astro and Vite build helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { Container, Directory, File } from "@dagger.io/dagger";

import { bunBaseContainer } from "./base";

/** Run astro check on a package. */
export function astroCheckHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Container {
  return bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig).withExec([
    "bunx",
    "astro",
    "check",
  ]);
}

/** Run astro build and return the output directory. */
export function astroBuildHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Directory {
  return bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig)
    .withExec(["bunx", "playwright", "install", "--with-deps", "chromium"])
    .withExec(["bunx", "astro", "build"])
    .directory(`/workspace/packages/${pkg}/dist`);
}

/** Run vite build and return the output directory. */
export function viteBuildHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Directory {
  return bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig)
    .withExec(["bunx", "vite", "build"])
    .directory(`/workspace/packages/${pkg}/dist`);
}
