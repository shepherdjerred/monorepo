import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createPhoenixPostgreSQLDatabase } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/phoenix-db.ts";
import { createPhoenixDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/phoenix/index.ts";

export function createPhoenixChart(app: App) {
  const chart = new Chart(app, "phoenix", {
    namespace: "phoenix",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "phoenix-namespace", {
    metadata: {
      name: "phoenix",
      labels: {
        // Audit/warn rather than enforce: the operator-managed Postgres pod
        // does not meet the restricted profile (same as bugsink).
        "pod-security.kubernetes.io/audit": "restricted",
        "pod-security.kubernetes.io/warn": "restricted",
      },
    },
  });

  createPhoenixPostgreSQLDatabase(chart);
  createPhoenixDeployment(chart);

  return chart;
}
