import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import {
  BASELINE_CHART_NAMESPACE,
  CLUSTER_OBSERVABILITY_CHART,
} from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/charts.ts";
import { createClusterObservability } from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/observability.ts";
import { adoptRootChartAddresses } from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/root-addresses.ts";

/** Mirrors the root's observability objects for the v2 cutover; the root keeps rendering them. */
export async function createClusterObservabilityChart(
  app: App,
): Promise<Chart> {
  const chart = new Chart(app, CLUSTER_OBSERVABILITY_CHART, {
    namespace: BASELINE_CHART_NAMESPACE,
    disableResourceNameHashes: true,
  });
  await createClusterObservability(chart);
  adoptRootChartAddresses(chart);
  return chart;
}
