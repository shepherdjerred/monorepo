/**
 * Go operation helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { Container, Directory } from "@dagger.io/dagger";

import { GOLANGCI_LINT_VERSION } from "./constants";

import { goBaseContainer } from "./base";

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
      "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@${GOLANGCI_LINT_VERSION}",
    ])
    .withExec(["golangci-lint", "run", "./..."]);
}
