import type { Chart } from "cdk8s";
import { PrometheusRule } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import { getBuildkitdRuleGroups } from "./monitoring/rules/buildkitd.ts";

/**
 * Scrapes buildkitd's debug endpoint (Prometheus /metrics on --debugaddr).
 *
 * buildkitd is the single shared build daemon every CI image build goes
 * through (remote buildx driver), yet it previously exposed no metrics at
 * all — its OOM crash loop during PR #1668's full-fleet bake was only
 * visible via kubectl. The Service label + debug port live in
 * resources/buildkitd.ts; the NetworkPolicy there admits the prometheus
 * namespace to the debug port only.
 */
export function createBuildkitdMonitoring(chart: Chart): void {
  createServiceMonitor(chart, {
    name: "buildkitd",
    namespace: "buildkitd",
    matchLabels: { app: "buildkitd" },
  });

  new PrometheusRule(chart, "prometheus-buildkitd-rules", {
    metadata: {
      name: "prometheus-buildkitd-rules",
      namespace: "buildkitd",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getBuildkitdRuleGroups(),
    },
  });
}
