import { App, Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createBugsinkPostgreSQLDatabase } from "../resources/postgres/bugsink-db.ts";
import { createBugsinkDeployment, createBugsinkHousekeepingCronJob } from "../resources/bugsink/index.ts";

export function createBugsinkChart(app: App) {
  const chart = new Chart(app, "bugsink", {
    namespace: "bugsink",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "bugsink-namespace", {
    metadata: {
      name: "bugsink",
      labels: {
        // Pod security standards - audit mode to avoid admission failures
        // (enforce requires seccompProfile and capabilities.drop which cdk8s-plus doesn't set by default)
        "pod-security.kubernetes.io/audit": "restricted",
        "pod-security.kubernetes.io/warn": "restricted",
      },
    },
  });

  createBugsinkPostgreSQLDatabase(chart);
  const { bugsinkSecrets } = createBugsinkDeployment(chart);
  createBugsinkHousekeepingCronJob(chart, bugsinkSecrets);
}
