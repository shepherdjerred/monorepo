/**
 * Java/Maven helper functions for building and testing Java projects.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory } from "@dagger.io/dagger";

// renovate: datasource=docker depName=maven
const MAVEN_IMAGE = "maven:3.9.9-eclipse-temurin-21";

/** Build a Maven project (castle-casters) with `mvn package -DskipTests`. */
export function mavenBuildHelper(source: Directory): Container {
  return dag
    .container()
    .from(MAVEN_IMAGE)
    .withWorkdir("/workspace")
    .withDirectory(
      "/workspace",
      source.directory("packages/castle-casters"),
      { exclude: [".git", "target"] },
    )
    .withExec(["mvn", "package", "-DskipTests"]);
}

/** Test a Maven project (castle-casters) with `mvn test`. */
export function mavenTestHelper(source: Directory): Container {
  return dag
    .container()
    .from(MAVEN_IMAGE)
    .withWorkdir("/workspace")
    .withDirectory(
      "/workspace",
      source.directory("packages/castle-casters"),
      { exclude: [".git", "target"] },
    )
    .withExec(["mvn", "test"]);
}
