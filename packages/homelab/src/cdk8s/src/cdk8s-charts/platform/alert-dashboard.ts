import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createAlertDashboardDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/alert-dashboard/index.ts";

export function createAlertDashboardChart(app: App) {
  const chart = new Chart(app, "alert-dashboard", {
    namespace: "alert-dashboard",
    disableResourceNameHashes: true,
  });
  new Namespace(chart, "alert-dashboard-namespace", {
    metadata: { name: "alert-dashboard" },
  });
  createAlertDashboardDeployment(chart);
}
