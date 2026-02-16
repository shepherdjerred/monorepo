import { Container, dag } from "@dagger.io/dagger";

// Re-export timing utilities from shared package
export {
  logWithTimestamp,
  withTiming,
  formatDuration,
} from "@shepherdjerred/dagger-utils/utils";

/**
 * Get a Maven container with Java 21 and Maven 3
 */
export function getMavenContainer(): Container {
  return dag
    .container()
    .from("maven:3-amazoncorretto-21")
    .withWorkdir("/workspace");
}

/**
 * Get a Maven container with cache mounted
 */
export function getMavenContainerWithCache(): Container {
  return getMavenContainer().withMountedCache(
    "/root/.m2/repository",
    dag.cacheVolume("maven-cache")
  );
}
