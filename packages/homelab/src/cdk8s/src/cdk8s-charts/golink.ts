import { App, Chart } from "cdk8s";
import { createGolinkDeployment } from "../resources/golink.ts";
import { createGolinkSyncJob } from "../resources/golink-sync.ts";

export function createGolinkChart(app: App) {
  const chart = new Chart(app, "golink", {
    namespace: "golink",
    disableResourceNameHashes: true,
  });

  createGolinkDeployment(chart);
  createGolinkSyncJob(chart);
}
