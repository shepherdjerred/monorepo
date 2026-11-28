import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { PostgresqlSpecUsers } from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";
import { closeActivationGate } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/activation.ts";
import { singleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import {
  FEEDS_ACTIVE,
  createFeedsDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/feeds/index.ts";

/** Prepared service: the chart is published inactive until its gate opens. */
export function createFeedsChart(app: App, active = FEEDS_ACTIVE) {
  const chart = new Chart(app, "feeds", {
    namespace: "feeds",
    disableResourceNameHashes: true,
  });
  if (!active) return closeActivationGate(chart);
  new Namespace(chart, "feeds-namespace", { metadata: { name: "feeds" } });
  // Feeds is moving from its SQLite file onto its own PostgreSQL cluster. The
  // cluster comes up beside the running app; the Deployment does not reference
  // it yet, so its pod never waits on the operator-generated credentials.
  const database = singleAppDatabase(chart, {
    app: "feeds",
    provision: true,
    userFlags: [PostgresqlSpecUsers.CREATEDB],
  });
  database.createClusterIngressPolicy(
    "feeds-pg-netpol",
    { app: "feeds" },
    { name: "feeds-pg-netpol" },
  );
  createFeedsDeployment(chart);
  return chart;
}
