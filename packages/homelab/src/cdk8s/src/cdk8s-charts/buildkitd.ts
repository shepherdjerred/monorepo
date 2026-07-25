import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createBuildkitdDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/buildkitd.ts";

export function createBuildkitdChart(app: App) {
  const chart = new Chart(app, "buildkitd", {
    namespace: "buildkitd",
    disableResourceNameHashes: true,
  });

  createBuildkitdDeployment(chart);
}
