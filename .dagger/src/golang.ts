/**
 * Go operation helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import type { Container, Directory } from "@dagger.io/dagger";

import { GOLANGCI_LINT_VERSION } from "./constants";

import { goBaseContainer } from "./base";
import { runBundle } from "./bundle";

/** Run go build. */
export function goBuildHelper(pkgDir: Directory): Container {
  return goBaseContainer(pkgDir).withExec(["go", "build", "./..."]);
}

/** Run go test. */
export function goTestHelper(pkgDir: Directory): Container {
  return goBaseContainer(pkgDir).withExec(["go", "test", "./...", "-v"]);
}

/** Run golangci-lint (v2). */
export function goLintHelper(pkgDir: Directory): Container {
  return goBaseContainer(pkgDir)
    .withExec([
      "go",
      "install",
      `github.com/golangci/golangci-lint/v2/cmd/golangci-lint@${GOLANGCI_LINT_VERSION}`,
    ])
    .withExec(["golangci-lint", "run", "./..."]);
}

/**
 * Bundle: go build + go test + golangci-lint in one pod, running as parallel
 * siblings. All three share the `goBaseContainer` prefix (same module
 * download / setup), so the engine content-addresses and de-dups the
 * shared layer.
 */
export async function goLintTestBuildHelper(
  pkgDir: Directory,
): Promise<string> {
  return runBundle([
    { name: "lint", run: () => goLintHelper(pkgDir).stdout() },
    { name: "test", run: () => goTestHelper(pkgDir).stdout() },
    { name: "build", run: () => goBuildHelper(pkgDir).stdout() },
  ]);
}
