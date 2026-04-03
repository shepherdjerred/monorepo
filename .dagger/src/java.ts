/**
 * Java/Maven helper functions for building and testing Java projects.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory } from "@dagger.io/dagger";
import { MAVEN_IMAGE, MAVEN_CACHE } from "./constants";

/** Build a Maven project (castle-casters) with `mvn package -DskipTests`. */
export function mavenBuildHelper(pkgDir: Directory): Container {
  return dag
    .container()
    .from(MAVEN_IMAGE)
    .withMountedCache("/root/.m2/repository", dag.cacheVolume(MAVEN_CACHE))
    .withWorkdir("/workspace")
    .withDirectory("/workspace", pkgDir, {
      exclude: [".git", "target"],
    })
    .withExec([
      "mvn",
      "package",
      "-DskipTests",
      "-Dmaven.wagon.http.connectionTimeout=10000",
      "-Dmaven.wagon.http.readTimeout=30000",
    ]);
}

/** Test a Maven project (castle-casters) with `mvn test`. */
export function mavenTestHelper(pkgDir: Directory): Container {
  return dag
    .container()
    .from(MAVEN_IMAGE)
    .withMountedCache("/root/.m2/repository", dag.cacheVolume(MAVEN_CACHE))
    .withWorkdir("/workspace")
    .withDirectory("/workspace", pkgDir, {
      exclude: [".git", "target"],
    })
    .withExec([
      "mvn",
      "test",
      "-Dmaven.wagon.http.connectionTimeout=10000",
      "-Dmaven.wagon.http.readTimeout=30000",
    ]);
}
