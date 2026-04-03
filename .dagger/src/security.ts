/**
 * Security scanning helper functions for repo-wide checks.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory } from "@dagger.io/dagger";

import { TRIVY_IMAGE, SEMGREP_IMAGE, SOURCE_EXCLUDES } from "./constants";

/** Scan the source tree with trivy for vulnerabilities (HIGH, CRITICAL severity). */
export function trivyScanHelper(source: Directory): Container {
  return dag
    .container()
    .from(TRIVY_IMAGE)
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source, {
      exclude: SOURCE_EXCLUDES,
    })
    .withExec([
      "trivy",
      "fs",
      "--exit-code",
      "1",
      "--severity",
      "HIGH,CRITICAL",
      "--ignorefile",
      "/workspace/.trivyignore",
      "/workspace",
    ]);
}

/** Scan the source tree with semgrep for code quality and security issues. */
export function semgrepScanHelper(source: Directory): Container {
  return dag
    .container()
    .from(SEMGREP_IMAGE)
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source, {
      exclude: SOURCE_EXCLUDES,
    })
    .withExec(["semgrep", "scan", "--config", "auto", "/workspace"]);
}
