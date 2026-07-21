import type { Chart } from "cdk8s";
import {
  PodMonitor,
  PrometheusRule,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { getBuildkiteRuleGroups } from "./monitoring/rules/buildkite.ts";

export const BUILDKITE_CONTROLLER_METRICS_INTERVAL = "10s";

/**
 * Scrapes the agent-stack controller's native Prometheus endpoint.
 *
 * The upstream chart's optional PodMonitor does not accept discovery labels,
 * while this cluster's Prometheus instance selects PodMonitors with
 * `release=prometheus`. Own the monitor here so a chart upgrade cannot leave
 * controller scheduling and cancellation telemetry undiscovered.
 */
export function createBuildkiteMonitoring(chart: Chart): void {
  new PodMonitor(chart, "buildkite-controller-pod-monitor", {
    metadata: {
      name: "buildkite-controller",
      namespace: "buildkite",
      labels: {
        release: "prometheus",
      },
    },
    spec: {
      namespaceSelector: {
        matchNames: ["buildkite"],
      },
      selector: {
        matchLabels: {
          app: "buildkite-agent-stack-k8s",
        },
      },
      podMetricsEndpoints: [
        {
          port: "metrics",
          path: "/metrics",
          interval: BUILDKITE_CONTROLLER_METRICS_INTERVAL,
        },
      ],
    },
  });

  // Keep kube-state-metrics on the normal stack cadence. A second 10-second
  // ServiceMonitor would still download and parse the complete cluster-wide
  // endpoint before metric relabeling discarded nearly all of it. Short-lived
  // pods that disappear between metadata scrapes stay explicit: the recording
  // join emits no attributed series, the running-pod alert detects live gaps,
  // and the CI I/O reporter marks missing metadata/jobs explicitly and uses
  // lower-bound coverage where the available samples require it.
  new PrometheusRule(chart, "prometheus-buildkite-rules", {
    metadata: {
      name: "prometheus-buildkite-rules",
      namespace: "buildkite",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getBuildkiteRuleGroups(),
    },
  });
}
