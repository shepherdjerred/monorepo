/**
 * Security scanning helper functions for repo-wide checks.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory } from "@dagger.io/dagger";

// renovate: datasource=docker depName=aquasec/trivy
const TRIVY_IMAGE = "aquasec/trivy:0.58.2";

// renovate: datasource=docker depName=semgrep/semgrep
const SEMGREP_IMAGE = "semgrep/semgrep:1.103.0";

const SOURCE_EXCLUDES = [
  "**/node_modules",
  "**/.eslintcache",
  "**/dist",
  "**/target",
  ".git",
  "**/.vscode",
  "**/.idea",
  "**/coverage",
  "**/build",
  "**/.next",
  "**/.tsbuildinfo",
  "**/__pycache__",
  "**/.DS_Store",
  "**/archive",
];

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
