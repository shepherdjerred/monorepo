import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createRelayDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/relay/index.ts";

export function createRelayChart(app: App) {
  const chart = new Chart(app, "relay", {
    namespace: "relay",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "relay-namespace", {
    metadata: {
      name: "relay",
      labels: {
        // Pod security standards - audit/warn only (see bugsink for rationale)
        "pod-security.kubernetes.io/audit": "restricted",
        "pod-security.kubernetes.io/warn": "restricted",
      },
    },
  });

  createRelayDeployment(chart);
}
