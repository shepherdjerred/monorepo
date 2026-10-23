import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createTemporalNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/namespace.ts";
import {
  createTemporalPostgreSQLDatabase,
  createTemporalPostgreSQLNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/temporal-db.ts";
import { createTemporalPostgreSQLCertificate } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/temporal-db-tls.ts";
import { retainDataLayerResource } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/data-layer.ts";
import { archivePostgresWal } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/wal-archive.ts";

/**
 * Temporal's data layer: the `temporal` Namespace, the PostgreSQL TLS chain,
 * the `temporal-postgresql` Zalando cluster, and the cluster's ingress
 * NetworkPolicy, owned by the operator-run `temporal-data` Application rather
 * than the automatically released `temporal` application chart. The schema
 * migration Job and every workload stay in the `temporal` chart.
 */
export function createTemporalDataChart(app: App): Chart {
  const chart = new Chart(app, "temporal-data", {
    namespace: "temporal",
    disableResourceNameHashes: true,
  });
  createTemporalNamespace(chart, { retained: true });
  createTemporalPostgreSQLCertificate(chart);
  const database = createTemporalPostgreSQLDatabase(chart);
  retainDataLayerResource(database);
  archivePostgresWal(database, "temporal-postgresql");
  createTemporalPostgreSQLNetworkPolicy(chart);
  return chart;
}
