import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import {
  createGradleBuildCacheDeployment,
  GRADLE_BUILD_CACHE_NAMESPACE,
} from "@shepherdjerred/homelab/cdk8s/src/resources/gradle-build-cache.ts";

export function createGradleBuildCacheChart(app: App) {
  const chart = new Chart(app, "gradle-build-cache", {
    namespace: GRADLE_BUILD_CACHE_NAMESPACE,
    disableResourceNameHashes: true,
  });

  createGradleBuildCacheDeployment(chart);
}
