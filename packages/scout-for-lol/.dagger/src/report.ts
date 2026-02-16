import type { Directory, Container } from "@dagger.io/dagger";
import { installWorkspaceDeps, getPreparedWorkspace } from "@scout-for-lol/.dagger/src/base";

/**
 * Install dependencies for the report package
 * @param workspaceSource The full workspace source directory
 * @returns The container with dependencies installed
 */
export function installReportDeps(workspaceSource: Directory): Container {
  return installWorkspaceDeps(workspaceSource);
}

/**
 * Run type checking, linting, and tests for the report package
 * @param workspaceSource The full workspace source directory
 * @param preparedWorkspace Optional pre-prepared container (with deps already installed)
 * @returns The test results
 */
export function checkReport(workspaceSource: Directory, preparedWorkspace?: Container): Container {
  const base = preparedWorkspace ?? getPreparedWorkspace(workspaceSource);
  return base
    .withWorkdir("/workspace/packages/report")
    .withExec(["bun", "run", "typecheck"])
    .withExec(["bun", "run", "lint"])
    .withExec(["bun", "run", "test:ci"]);
}

/**
 * Export test coverage for the report package
 * @param workspaceSource The full workspace source directory
 * @returns The coverage directory
 */
export function getReportCoverage(workspaceSource: Directory): Directory {
  return checkReport(workspaceSource).directory("/workspace/packages/report/coverage");
}

/**
 * Export test report for the report package
 * @param workspaceSource The full workspace source directory
 * @returns The test report file
 */
export function getReportTestReport(workspaceSource: Directory): Directory {
  return checkReport(workspaceSource).directory("/workspace/packages/report");
}
