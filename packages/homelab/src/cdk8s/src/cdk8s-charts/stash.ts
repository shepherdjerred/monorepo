import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createStashDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/stash/index.ts";

export function createStashChart(app: App) {
  const chart = new Chart(app, "stash", {
    namespace: "stash",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "stash-namespace", {
    metadata: { name: "stash" },
  });

  createStashDeployment(chart);
}
