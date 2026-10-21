import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import {
  BASELINE_CHART_NAMESPACE,
  CLUSTER_ADMISSION_CHART,
} from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/charts.ts";
import { createClusterAdmission } from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/admission.ts";
import { adoptRootChartAddresses } from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/root-addresses.ts";

/** Mirrors the root's admission policies for the v2 cutover; the root keeps rendering them. */
export function createClusterAdmissionChart(app: App): Chart {
  const chart = new Chart(app, CLUSTER_ADMISSION_CHART, {
    namespace: BASELINE_CHART_NAMESPACE,
    disableResourceNameHashes: true,
  });
  createClusterAdmission(chart);
  adoptRootChartAddresses(chart);
  return chart;
}
