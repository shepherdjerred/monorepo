import type { Directory, Container } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { runNamedParallel, type NamedResult } from "./lib/index.ts";

/**
 * Get a Maven container with Java 21 and Maven 3
 */
function getMavenContainer(): Container {
  return dag
    .container()
    .from("maven:3-amazoncorretto-21")
    .withWorkdir("/workspace");
}

/**
 * Get a Maven container with cache mounted
 */
function getMavenContainerWithCache(): Container {
  return getMavenContainer().withMountedCache(
    "/root/.m2/repository",
    dag.cacheVolume("maven-cache"),
  );
}

/**
 * Build the project with Maven
 */
async function buildProject(source: Directory): Promise<Container> {
  const container = getMavenContainerWithCache()
    .withDirectory(".", source)
    .withExec(["mvn", "clean", "package", "-DskipTests"]);

  await container.sync();
  return container;
}

/**
 * Run tests with Maven
 */
async function runTests(source: Directory): Promise<Container> {
  const container = getMavenContainerWithCache()
    .withDirectory(".", source)
    .withExec(["mvn", "test"]);

  await container.sync();
  return container;
}

/**
 * Check code quality with Maven (compile check)
 */
async function checkCodeQuality(source: Directory): Promise<Container> {
  const container = getMavenContainerWithCache()
    .withDirectory(".", source)
    .withExec(["mvn", "compile"]);

  await container.sync();
  return container;
}

/**
 * Run all Castle Casters checks (build, test, code quality) in parallel.
 *
 * Extracts the `packages/castle-casters` subdirectory from the monorepo source,
 * creates Maven containers, and runs build, test, and quality checks in parallel.
 *
 * @param source - The full monorepo source directory
 * @returns A message indicating completion
 */
export async function checkCastleCasters(source: Directory): Promise<string> {
  const castleCastersSource = source.directory("packages/castle-casters");

  const results: NamedResult<Container>[] = await runNamedParallel([
    { name: "build", operation: () => buildProject(castleCastersSource) },
    { name: "test", operation: () => runTests(castleCastersSource) },
    { name: "quality", operation: () => checkCodeQuality(castleCastersSource) },
  ]);

  // Check for failures and report all of them
  const failures = results.filter((r) => !r.success);
  if (failures.length > 0) {
    const failureMessages = failures
      .map(
        (f) =>
          `${f.name}: ${f.error instanceof Error ? f.error.message : String(f.error)}`,
      )
      .join("\n");
    throw new Error(`Castle Casters check failed:\n${failureMessages}`);
  }

  return "All Castle Casters checks passed: build, test, and code quality verification completed successfully.";
}
