import { Container, Directory } from "@dagger.io/dagger";
import { getMavenContainerWithCache, withTiming } from "./base";

/**
 * Resolve Maven dependencies
 */
export async function resolveDependencies(source: Directory): Promise<Container> {
  return withTiming("Maven dependency resolution", async () => {
    const container = getMavenContainerWithCache()
      .withFile("pom.xml", source.file("pom.xml"));

    await container.withExec(["mvn", "dependency:resolve"]).sync();

    return container;
  });
}

/**
 * Build the project with Maven
 */
export async function buildProject(source: Directory): Promise<Container> {
  return withTiming("Maven build", async () => {
    const container = getMavenContainerWithCache()
      .withDirectory(".", source)
      .withExec(["mvn", "clean", "package", "-DskipTests"]);

    await container.sync();
    return container;
  });
}

/**
 * Run tests with Maven
 */
export async function runTests(source: Directory): Promise<Container> {
  return withTiming("Maven test execution", async () => {
    const container = getMavenContainerWithCache()
      .withDirectory(".", source)
      .withExec(["mvn", "test"]);

    await container.sync();
    return container;
  });
}

/**
 * Get the built JAR artifact
 */
export async function getJarArtifact(buildContainer: Container): Promise<Directory> {
  return withTiming("Extract JAR artifact", async () => {
    return buildContainer.directory("target");
  });
}

/**
 * Check code quality with Maven
 */
export async function checkCodeQuality(source: Directory): Promise<Container> {
  return withTiming("Maven code quality check", async () => {
    const container = getMavenContainerWithCache()
      .withDirectory(".", source)
      .withExec(["mvn", "compile"]);

    await container.sync();
    return container;
  });
}

/**
 * Generate coverage report
 */
export async function generateCoverageReport(source: Directory): Promise<Container> {
  return withTiming("Maven coverage report", async () => {
    const container = getMavenContainerWithCache()
      .withDirectory(".", source)
      .withExec(["mvn", "jacoco:prepare-agent", "test", "jacoco:report"]);

    await container.sync();
    return container;
  });
}
