import { dag, Directory, Container, Secret } from "@dagger.io/dagger";
import { getBunContainer, getBunNodeContainer } from "./base";

/**
 * Get the report source directory
 * @param source The source directory
 * @returns The report source directory
 */
export function getReportSource(source: Directory): Directory {
  return source.directory("src");
}

/**
 * Install dependencies for the report package
 * @param source The source directory
 * @param dataSource The data package source
 * @returns The container with dependencies installed
 */
export function installReportDeps(source: Directory, dataSource: Directory): Container {
  return getBunContainer()
    .withWorkdir("/workspace/packages/report")
    .withDirectory("/workspace/packages/data/src", dataSource)
    .withDirectory("/workspace/packages/report", source)
    .withWorkdir("/workspace/packages/report")
    .withExec(["bun", "install", "--frozen-lockfile"]);
}

/**
 * Update the Bun lockfile for report
 * @param source The source directory
 * @returns The updated lockfile
 */
export function updateReportLockfile(source: Directory): Directory {
  return getBunContainer()
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace/packages/report")
    .withExec(["bun", "install"])
    .directory("/workspace/packages/report");
}

/**
 * Run type checking, linting, and tests for the report package
 * @param source The source directory
 * @param dataSource The data package source
 * @returns The test results
 */
export function checkReport(source: Directory, dataSource: Directory): Container {
  return installReportDeps(source, dataSource)
    .withExec(["bun", "run", "type-check"])
    .withExec(["bun", "run", "lint"])
    .withExec(["bun", "test"]);
}

/**
 * Install dependencies for DNT (Deno to Node Transform) build
 * @param source The source directory
 * @param dataSource The data package source
 * @returns The container with DNT dependencies
 */
export function installDntDeps(source: Directory, dataSource: Directory): Container {
  return getBunNodeContainer()
    .withWorkdir("/workspace/packages/report")
    .withDirectory("/workspace/packages/data/src", dataSource)
    .withDirectory("/workspace/packages/report", source)
    .withWorkdir("/workspace/packages/report");
}

/**
 * Build the report package for npm distribution
 * @param source The source directory
 * @param dataSource The data package source
 * @param version The version to build
 * @returns The built npm package directory
 */
export function buildReportForNpm(source: Directory, dataSource: Directory, version: string): Directory {
  return installDntDeps(source, dataSource)
    .withEnvVariable("VERSION", version)
    .withExec(["bun", "run", "build.ts"])
    .directory("/workspace/packages/report/npm");
}

/**
 * Publish the report package to npm
 * @param source The source directory
 * @param dataSource The data package source
 * @param version The version to publish
 * @param npmToken The npm token secret
 * @returns The publish result
 */
export async function publishReportToNpm(
  source: Directory,
  dataSource: Directory,
  version: string,
  npmToken: Secret,
): Promise<string> {
  const npmDir = buildReportForNpm(source, dataSource, version);

  return dag
    .container()
    .from("node:lts")
    .withWorkdir("/workspace")
    .withDirectory("/workspace", npmDir)
    .withFile(".npmrc", source.file(".npmrc"))
    .withSecretVariable("NPM_TOKEN", npmToken)
    .withExec(["npm", "publish", "--access=public"])
    .stdout();
}
