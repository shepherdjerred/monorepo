import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createDeliveryNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/namespace.ts";
import { createSingleAppPostgreSQL } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/single-app-postgresql.ts";
import { retainDataLayerResource } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/data-layer.ts";
import { archivePostgresWal } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/wal-archive.ts";

/**
 * Delivery's data layer: the `delivery` Namespace and the `delivery-postgresql`
 * Zalando cluster, owned by the operator-run `delivery-data` Application
 * rather than the automatically released `delivery` application chart. An
 * ordinary Delivery release can therefore never rewrite the database
 * definition, and the apply-safety preflight guards the data chart's own
 * releases.
 */
export function createDeliveryDataChart(app: App): Chart {
  const chart = new Chart(app, "delivery-data", {
    namespace: "delivery",
    disableResourceNameHashes: true,
  });
  createDeliveryNamespace(chart, { retained: true });
  const database = createSingleAppPostgreSQL(chart, {
    app: "delivery",
    userFlags: [],
  });
  retainDataLayerResource(database);
  archivePostgresWal(database, "delivery-postgresql");
  return chart;
}
