import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createBirmelDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/birmel/index.ts";

export function createBirmelChart(app: App) {
  const chart = new Chart(app, "birmel", {
    namespace: "birmel",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "birmel-namespace", {
    metadata: {
      name: "birmel",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/audit": "restricted",
        "pod-security.kubernetes.io/warn": "restricted",
      },
    },
  });

  createBirmelDeployment(chart);
}
