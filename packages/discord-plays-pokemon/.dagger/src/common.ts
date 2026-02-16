import { Directory, Container } from "@dagger.io/dagger";
import { getBaseBunContainer } from "./base";

/**
 * Install dependencies for the common package
 * @param workspaceSource The full workspace source directory
 * @returns The container with dependencies installed
 */
export function installCommonDeps(workspaceSource: Directory): Container {
  // Mount the full workspace to satisfy bun workspace requirements
  return getBaseBunContainer()
    .withFile("/workspace/package.json", workspaceSource.file("package.json"))
    .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    .withDirectory("/workspace/packages/common", workspaceSource.directory("packages/common"))
    .withDirectory("/workspace/packages/backend", workspaceSource.directory("packages/backend"))
    .withDirectory("/workspace/packages/frontend", workspaceSource.directory("packages/frontend"))
    .withWorkdir("/workspace")
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withWorkdir("/workspace/packages/common")
    .withExec(["bun", "install"]);
}

/**
 * Run linting for the common package
 * @param workspaceSource The full workspace source directory
 * @returns The container with linting results
 */
export function lintCommon(workspaceSource: Directory): Container {
  return installCommonDeps(workspaceSource).withExec(["bun", "run", "lint:check"]);
}

/**
 * Build the common package
 * @param workspaceSource The full workspace source directory
 * @returns The container with build artifacts
 */
export function buildCommon(workspaceSource: Directory): Container {
  return installCommonDeps(workspaceSource).withExec(["bun", "run", "build"]);
}

/**
 * Test the common package
 * @param workspaceSource The full workspace source directory
 * @returns The container with test results
 */
export function testCommon(workspaceSource: Directory): Container {
  return installCommonDeps(workspaceSource).withExec(["bun", "run", "test"]);
}

/**
 * Pack the common package for use in other packages
 * @param workspaceSource The full workspace source directory
 * @returns The built and packed package
 */
export function packCommon(workspaceSource: Directory): Container {
  return buildCommon(workspaceSource).withExec(["bun", "pm", "pack"]);
}

/**
 * Get the packed common package artifact
 * @param workspaceSource The full workspace source directory
 * @returns The packed tarball file
 */
export async function getCommonPackage(workspaceSource: Directory): Promise<Directory> {
  return packCommon(workspaceSource).directory("/workspace/packages/common");
}
