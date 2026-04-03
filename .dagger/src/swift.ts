/**
 * Swift operation helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory } from "@dagger.io/dagger";

import { SWIFTLINT_IMAGE } from "./constants";

/** Run swiftlint on a Swift package. */
export function swiftLintHelper(source: Directory, pkg: string): Container {
  return dag
    .container()
    .from(SWIFTLINT_IMAGE)
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source.directory(`packages/${pkg}`), {
      exclude: [".build/**", "**/.build/**"],
    })
    .withExec(["swiftlint", "--strict"]);
}
