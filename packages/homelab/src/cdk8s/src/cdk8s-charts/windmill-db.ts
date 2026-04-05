import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createWindmillPostgreSQLDatabase } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/windmill-db.ts";
import { createWindmillDbUrlJob } from "@shepherdjerred/homelab/cdk8s/src/resources/windmill/db-url-job.ts";

export function createWindmillDbChart(app: App) {
  const chart = new Chart(app, "windmill-db", {
    namespace: "windmill",
    disableResourceNameHashes: true,
  });

  createWindmillPostgreSQLDatabase(chart);
  createWindmillDbUrlJob(chart);
}
