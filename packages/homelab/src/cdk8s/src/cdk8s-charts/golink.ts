import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createGolinkDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/golink.ts";
import { createGolinkSyncJob } from "@shepherdjerred/homelab/cdk8s/src/resources/golink-sync.ts";

export function createGolinkChart(app: App) {
  const chart = new Chart(app, "golink", {
    namespace: "golink",
    disableResourceNameHashes: true,
  });

  createGolinkDeployment(chart);
  createGolinkSyncJob(chart);
}
