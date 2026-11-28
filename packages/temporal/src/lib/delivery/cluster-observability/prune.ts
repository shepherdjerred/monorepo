import {
  retiredRouteSyncPrunes,
  type RetiredRouteRelease,
  type RetiredRouteRule,
} from "#lib/delivery/retired-route-prune.ts";

/**
 * `cluster-observability` (`destination.namespace: "argocd"`) owns derived
 * stateless `monitoring.coreos.com/v1` `PrometheusRule` CRs (`prometheus-*`)
 * across monitoring and workload namespaces. Its owned sync may prune retired
 * owned `PrometheusRule` CRs when rules leave the chart render; storage and
 * unrelated resources are never candidates.
 */
const CLUSTER_OBSERVABILITY: RetiredRouteRule = {
  application: "cluster-observability",
  chart: "cluster-observability",
  namespace: "argocd",
  environmentId: "cluster-observability/prod",
  allowAnyResourceNamespace: true,
  matches: ({ group, kind, name }) =>
    group === "monitoring.coreos.com" &&
    kind === "PrometheusRule" &&
    name.startsWith("prometheus-"),
  label: "Cluster observability",
  resourceNoun: "PrometheusRule",
};

/** Retire only `cluster-observability`'s owned `PrometheusRule` CRs through its owned release. */
export async function clusterObservabilitySyncPrunes(
  release: RetiredRouteRelease,
  read: (path: string) => Promise<unknown>,
): Promise<boolean> {
  return await retiredRouteSyncPrunes(CLUSTER_OBSERVABILITY, release, read);
}
