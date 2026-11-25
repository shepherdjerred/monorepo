import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { PostgresqlSpecUsers } from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";
import { closeActivationGate } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/activation.ts";
import { singleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import {
  ERRORS_ACTIVE,
  createErrorsDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/errors/index.ts";

export function createErrorsChart(app: App, active = ERRORS_ACTIVE) {
  const chart = new Chart(app, "errors", {
    namespace: "errors",
    disableResourceNameHashes: true,
  });
  if (!active) return closeActivationGate(chart);
  new Namespace(chart, "errors-namespace", { metadata: { name: "errors" } });
  const database = singleAppDatabase(chart, {
    app: "errors",
    provision: true,
    userFlags: [PostgresqlSpecUsers.CREATEDB],
  });
  database.createClusterIngressPolicy(
    "errors-pg-netpol",
    { app: "errors" },
    { name: "errors-pg-netpol" },
  );
  createErrorsDeployment(chart, database);
  return chart;
}
