import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

/**
 * Operator-run owner of Temporal's Namespace, PostgreSQL TLS chain, cluster
 * and database NetworkPolicy. It is synced only on request, through the
 * guarded `release-root` procedure, never by ArgoCD automation or a Temporal
 * deployment of the `temporal` application chart.
 */
export function createTemporalDataApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "temporal-data",
    namespace: "temporal",
    // No automated sync: restoring the database from a Velero backup
    // deletes its `postgresql` object, and an automated sync would
    // recreate an empty cluster over the volume being restored.
    syncPolicy: undefined,
  });
}
