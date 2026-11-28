import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { PostgresqlSpecUsers } from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";
import { singleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import { createAlertDashboardDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/alert-dashboard/index.ts";

export function createAlertDashboardChart(app: App) {
  const chart = new Chart(app, "alert-dashboard", {
    namespace: "alert-dashboard",
    disableResourceNameHashes: true,
  });
  new Namespace(chart, "alert-dashboard-namespace", {
    metadata: { name: "alert-dashboard" },
  });
  // Hub's Incidents module (`@shepherdjerred/incidents`) keeps its own
  // PostgreSQL database; Hub's own ledger stays on SQLite.
  const incidentsDatabase = singleAppDatabase(chart, {
    app: "incidents",
    provision: true,
    userFlags: [PostgresqlSpecUsers.CREATEDB],
  });
  incidentsDatabase.createClusterIngressPolicy(
    "incidents-pg-netpol",
    { app: "alert-dashboard" },
    { name: "incidents-pg-netpol" },
  );
  createAlertDashboardDeployment(chart, incidentsDatabase);
}
