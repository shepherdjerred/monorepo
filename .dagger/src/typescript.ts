/**
 * TypeScript lint, typecheck, test, and generate helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory, File } from "@dagger.io/dagger";

import { ESLINT_CACHE } from "./constants";

import { bunBaseContainer } from "./base";

/** Run the lint script on a bun container. */
export function lintHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Container {
  return bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig)
    .withMountedCache(
      `/workspace/packages/${pkg}/.eslintcache`,
      dag.cacheVolume(ESLINT_CACHE),
    )
    .withExec(["bun", "run", "lint"]);
}

/** Run the typecheck script on a bun container. */
export function typecheckHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Container {
  return bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig).withExec([
    "bun",
    "run",
    "typecheck",
  ]);
}

/** Run the build script on a bun container (validates compilation). */
export function buildHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Container {
  return bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig).withExec([
    "bun",
    "run",
    "build",
  ]);
}

/** Run the test script on a bun container. */
export function testHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Container {
  return bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig).withExec([
    "bun",
    "run",
    "test",
  ]);
}

/** Run bun run generate and return the container (for chaining lint/typecheck/test). */
export function generateContainer(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Container {
  return bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig)
    .withWorkdir(`/workspace/packages/${pkg}`)
    .withExec(["bun", "run", "generate"]);
}

/** Generate then lint — chains on the same container to avoid SIGILL from bun install in fresh containers. */
export function generateAndLintHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Container {
  return generateContainer(pkgDir, pkg, depNames, depDirs, tsconfig)
    .withMountedCache(
      `/workspace/packages/${pkg}/.eslintcache`,
      dag.cacheVolume(ESLINT_CACHE),
    )
    .withExec(["bun", "run", "lint"]);
}

/** Generate then typecheck — chains on the same container. */
export function generateAndTypecheckHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Container {
  return generateContainer(pkgDir, pkg, depNames, depDirs, tsconfig).withExec([
    "bun",
    "run",
    "typecheck",
  ]);
}

/** Generate then test — chains on the same container. */
export function generateAndTestHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Container {
  return generateContainer(pkgDir, pkg, depNames, depDirs, tsconfig).withExec([
    "bun",
    "run",
    "test",
  ]);
}
