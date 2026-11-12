import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createTasknotesDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/tasknotes/index.ts";

export function createTasknotesChart(app: App) {
  const chart = new Chart(app, "tasknotes", {
    namespace: "tasknotes",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "tasknotes-namespace", {
    metadata: {
      name: "tasknotes",
    },
  });

  createTasknotesDeployment(chart);
}
