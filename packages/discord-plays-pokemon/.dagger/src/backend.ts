import { Directory, Container } from "@dagger.io/dagger";
import { getBaseBunContainer } from "./base";
import { getCommonPackage } from "./common";

/**
 * Install dependencies for the backend package
 * @param workspaceSource The full workspace source directory
 * @returns The container with dependencies installed
 */
export async function installBackendDeps(workspaceSource: Directory): Promise<Container> {
  // First get the built common package
  const commonDir = await getCommonPackage(workspaceSource);

  // Mount all workspace packages - bun workspaces handle the dependency resolution
  return getBaseBunContainer()
    .withFile("/workspace/package.json", workspaceSource.file("package.json"))
    .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    .withDirectory("/workspace/packages/backend", workspaceSource.directory("packages/backend"))
    .withDirectory("/workspace/packages/frontend", workspaceSource.directory("packages/frontend"))
    .withDirectory("/workspace/packages/common", commonDir)
    .withWorkdir("/workspace")
    .withExec(["bun", "install", "--frozen-lockfile"]);
}

/**
 * Run linting for the backend package
 * @param workspaceSource The full workspace source directory
 * @returns The container with linting results
 */
export async function lintBackend(workspaceSource: Directory): Promise<Container> {
  return (await installBackendDeps(workspaceSource))
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "run", "lint:check"]);
}

/**
 * Build the backend package
 * @param workspaceSource The full workspace source directory
 * @returns The container with build artifacts
 */
export async function buildBackend(workspaceSource: Directory): Promise<Container> {
  return (await installBackendDeps(workspaceSource))
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "run", "build"]);
}

/**
 * Test the backend package
 * @param workspaceSource The full workspace source directory
 * @returns The container with test results
 */
export async function testBackend(workspaceSource: Directory): Promise<Container> {
  return (await installBackendDeps(workspaceSource))
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "run", "test"]);
}

/**
 * Get the backend build artifacts
 * @param workspaceSource The full workspace source directory
 * @returns The built backend directory
 */
export async function getBackendBuild(workspaceSource: Directory): Promise<Directory> {
  return (await buildBackend(workspaceSource)).directory("/workspace/packages/backend/dist");
}

/**
 * Get the backend with dependencies for Docker image building
 * @param workspaceSource The full workspace source directory
 * @returns The backend directory with node_modules
 */
export async function getBackendWithDeps(workspaceSource: Directory): Promise<Directory> {
  return (await installBackendDeps(workspaceSource)).directory("/workspace/packages/backend");
}
