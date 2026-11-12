import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createSyncthingDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/syncthing.ts";

export function createSyncthingChart(app: App) {
  const chart = new Chart(app, "syncthing", {
    namespace: "syncthing",
    disableResourceNameHashes: true,
  });

  // The Deployment, its claims, Service, tailnet host and the namespace's
  // NetworkPolicies.
  createSyncthingDeployment(chart);
}
