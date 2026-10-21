import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import {
  BASELINE_CHART_NAMESPACE,
  CLUSTER_PLATFORM_CHART,
} from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/charts.ts";
import { createClusterPlatform } from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/platform.ts";
import { adoptRootChartAddresses } from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/root-addresses.ts";

/** Mirrors the root's cluster platform objects for the v2 cutover; the root keeps rendering them. */
export function createClusterPlatformChart(app: App): Chart {
  const chart = new Chart(app, CLUSTER_PLATFORM_CHART, {
    namespace: BASELINE_CHART_NAMESPACE,
    disableResourceNameHashes: true,
  });
  createClusterPlatform(chart);
  adoptRootChartAddresses(chart);
  return chart;
}
