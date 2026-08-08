import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createTrackerTrackerPostgreSQLDatabase } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/tracker-tracker-db.ts";
import { createTrackerTrackerDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/tracker-tracker/index.ts";

export function createTrackerTrackerChart(app: App) {
  const chart = new Chart(app, "tracker-tracker", {
    namespace: "tracker-tracker",
    disableResourceNameHashes: true,
  });

  createTrackerTrackerPostgreSQLDatabase(chart);
  createTrackerTrackerDeployment(chart);
}
