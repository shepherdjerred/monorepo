import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createStormBrainDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/storm-brain/index.ts";

export function createStormBrainChart(app: App) {
  const chart = new Chart(app, "storm-brain", {
    namespace: "storm-brain",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "storm-brain-namespace", {
    metadata: {
      name: "storm-brain",
      labels: {
        "pod-security.kubernetes.io/enforce": "restricted",
      },
    },
  });

  createStormBrainDeployment(chart);

  return chart;
}
