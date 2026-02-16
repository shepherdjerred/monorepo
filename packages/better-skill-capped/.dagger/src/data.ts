import { Directory, Container } from "@dagger.io/dagger";
import { getBunContainer } from "./base";

/**
 * Get the data source directory
 * @param source The source directory
 * @returns The data source directory
 */
export function getDataSource(source: Directory): Directory {
  return source.directory("src");
}

/**
 * Install dependencies for the data package
 * @param source The source directory
 * @returns The container with dependencies installed
 */
export function installDataDeps(source: Directory): Container {
  return getBunContainer()
    .withWorkdir("/workspace/packages/data")
    .withDirectory("/workspace/packages/data", source)
    .withWorkdir("/workspace/packages/data")
    .withExec(["bun", "install", "--frozen-lockfile"]);
}

/**
 * Update the Bun lockfile for data
 * @param source The source directory
 * @returns The updated lockfile
 */
export function updateDataLockfile(source: Directory): Directory {
  return getBunContainer()
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace/packages/data")
    .withExec(["bun", "install"])
    .directory("/workspace/packages/data");
}

/**
 * Run type checking and linting for the data package
 * @param source The source directory
 * @returns The check results
 */
export function checkData(source: Directory): Container {
  return installDataDeps(source).withExec(["bun", "run", "type-check"]).withExec(["bun", "run", "lint"]);
  // Note: Tests are commented out in the original Earthfile
  // .withExec(["bun", "test"]);
}
