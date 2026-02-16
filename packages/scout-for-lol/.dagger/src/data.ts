import type { Directory, Container } from "@dagger.io/dagger";
import { installWorkspaceDeps, getPreparedWorkspace } from "@scout-for-lol/.dagger/src/base";

/**
 * Install dependencies for the data package
 * @param workspaceSource The full workspace source directory
 * @returns The container with dependencies installed
 */
export function installDataDeps(workspaceSource: Directory): Container {
  return installWorkspaceDeps(workspaceSource);
}

/**
 * Run type checking and linting for the data package
 * @param workspaceSource The full workspace source directory
 * @param preparedWorkspace Optional pre-prepared container (with deps already installed)
 * @returns The check results
 */
export function checkData(workspaceSource: Directory, preparedWorkspace?: Container): Container {
  const base = preparedWorkspace ?? getPreparedWorkspace(workspaceSource);
  return base
    .withWorkdir("/workspace/packages/data")
    .withExec(["bun", "run", "typecheck"])
    .withExec(["bun", "run", "lint"])
    .withExec(["bun", "run", "test:ci"]);
}

/**
 * Export test coverage for the data package
 * @param workspaceSource The full workspace source directory
 * @returns The coverage directory
 */
export function getDataCoverage(workspaceSource: Directory): Directory {
  return checkData(workspaceSource).directory("/workspace/packages/data/coverage");
}

/**
 * Export test report for the data package
 * @param workspaceSource The full workspace source directory
 * @returns The test report file
 */
export function getDataTestReport(workspaceSource: Directory): Directory {
  return checkData(workspaceSource).directory("/workspace/packages/data");
}
