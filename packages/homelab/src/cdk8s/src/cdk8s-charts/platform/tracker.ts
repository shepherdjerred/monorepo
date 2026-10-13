import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { ConfigMap, Namespace } from "cdk8s-plus-31";
import { PostgresqlSpecUsers } from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";
import { createSingleAppPostgreSQL } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/single-app-postgresql.ts";
import { createTrackerDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/tracker/index.ts";
import { createTrackerNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/src/resources/tracker/network-policy.ts";

/** Preregistered service: setup-charts and Argo activate only after its image is published. */
export function createTrackerChart(app: App, image: string | undefined) {
  const chart = new Chart(app, "tracker", {
    namespace: "tracker",
    disableResourceNameHashes: true,
  });
  // Keep the Helm inventory complete before the image gate opens, as other prepared services do.
  // The apps chart still omits Tracker, so this marker does not activate any live resources.
  if (image === undefined) {
    new ConfigMap(chart, "activation", { data: { active: "false" } });
    return chart;
  }
  new Namespace(chart, "tracker-namespace", { metadata: { name: "tracker" } });
  createSingleAppPostgreSQL(chart, {
    app: "tracker",
    userFlags: [PostgresqlSpecUsers.CREATEDB],
  });
  createTrackerDeployment(chart, image);
  createTrackerNetworkPolicy(chart);
  return chart;
}
