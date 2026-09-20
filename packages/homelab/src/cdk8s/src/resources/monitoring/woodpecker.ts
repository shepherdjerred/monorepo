import type { Chart } from "cdk8s";
import {
  PodMonitor,
  PrometheusRule,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { getWoodpeckerRuleGroups } from "./monitoring/rules/woodpecker.ts";

export const CI_METRICS_SCRAPE_INTERVAL = "10s";

/**
 * Scrapes the Woodpecker server's Prometheus endpoint.
 *
 * Successor to the agent-stack-k8s controller monitor: that controller was
 * what scheduled and cancelled Buildkite jobs, and Woodpecker's server holds
 * the equivalent state. It serves /metrics only when
 * `WOODPECKER_PROMETHEUS_AUTH_TOKEN` is set and only to a scraper presenting
 * that token, which is why this monitor carries `bearerTokenSecret` reading
 * the same key the server does.
 */
export function createWoodpeckerMonitoring(chart: Chart): void {
  new PodMonitor(chart, "woodpecker-server-pod-monitor", {
    metadata: {
      name: "woodpecker-server",
      namespace: "woodpecker",
      labels: {
        release: "prometheus",
      },
    },
    spec: {
      namespaceSelector: {
        matchNames: ["woodpecker"],
      },
      selector: {
        matchLabels: {
          app: "woodpecker-server",
        },
      },
      podMetricsEndpoints: [
        {
          port: "http",
          path: "/metrics",
          interval: CI_METRICS_SCRAPE_INTERVAL,
          bearerTokenSecret: {
            name: "woodpecker-server-credentials",
            key: "WOODPECKER_PROMETHEUS_AUTH_TOKEN",
          },
        },
      ],
    },
  });

  // Keep kube-state-metrics on the normal stack cadence. A second 10-second
  // ServiceMonitor would still download and parse the complete cluster-wide
  // endpoint before metric relabeling discarded nearly all of it. Short-lived
  // pods that disappear between metadata scrapes stay explicit: the primary
  // pod-name-selected counters still include their I/O, the metadata join emits
  // no by-job series, the running-pod alert detects live gaps, and the CI I/O
  // reporter marks missing metadata/jobs explicitly and uses lower-bound
  // coverage where the available samples require it.
  new PrometheusRule(chart, "prometheus-woodpecker-rules", {
    metadata: {
      name: "prometheus-woodpecker-rules",
      namespace: "woodpecker",
      labels: { release: "prometheus" },
    },
    spec: {
      groups: getWoodpeckerRuleGroups(),
    },
  });
}
