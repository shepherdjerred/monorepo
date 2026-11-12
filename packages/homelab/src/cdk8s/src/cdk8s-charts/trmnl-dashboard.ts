import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createTrmnlDashboardDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/trmnl-dashboard/index.ts";

export function createTrmnlDashboardChart(app: App) {
  const chart = new Chart(app, "trmnl-dashboard", {
    namespace: "trmnl-dashboard",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "trmnl-dashboard-namespace", {
    metadata: {
      name: "trmnl-dashboard",
    },
  });

  createTrmnlDashboardDeployment(chart);
}
