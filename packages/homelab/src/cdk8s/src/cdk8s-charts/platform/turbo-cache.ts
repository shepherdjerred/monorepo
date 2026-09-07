import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createTurboCacheDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/turbo-cache.ts";

export function createTurboCacheChart(app: App) {
  const chart = new Chart(app, "turbo-cache", {
    namespace: "turbo-cache",
    disableResourceNameHashes: true,
  });

  createTurboCacheDeployment(chart);
}
