import type { Chart } from "cdk8s";
import { platformModel } from "homelab/src/platform-model.ts";
import {
  PodMonitor,
  ServiceMonitor,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com.ts";

/**
 * Scrapes existing Prometheus endpoints on upstream observability and edge
 * workloads without mutating their upstream chart values.
 *
 * Rendered through `createPrometheusMonitoring` so both the root chart and the
 * `cluster-observability` baseline chart carry identical monitor inventories.
 */
export function createObservabilityScrapers(chart: Chart): void {
  // Loki's Services (`loki`, `loki-canary`, `loki-chunks-cache`,
  // `loki-results-cache`) expose `http-metrics`, while `loki-gateway` and
  // `loki-headless` opt out with `prometheus.io/service-monitor: "false"`.
  new ServiceMonitor(chart, "loki-service-monitor", {
    metadata: {
      name: "loki-service-monitor",
      namespace: "loki",
      labels: { release: "prometheus" },
    },
    spec: {
      namespaceSelector: { matchNames: ["loki"] },
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "loki",
          "app.kubernetes.io/instance": "loki",
        },
        matchExpressions: [
          {
            key: "prometheus.io/service-monitor",
            operator: "NotIn",
            values: ["false"],
          },
        ],
      },
      endpoints: [
        {
          port: "http-metrics",
          path: "/metrics",
          interval: "30s",
        },
      ],
    },
  });

  // Promtail runs as a DaemonSet without a Service when chart-rendered
  // ServiceMonitors are off; its pods expose `http-metrics` on :3101 directly.
  new PodMonitor(chart, "promtail-pod-monitor", {
    metadata: {
      name: "promtail",
      namespace: "promtail",
      labels: { release: "prometheus" },
    },
    spec: {
      namespaceSelector: { matchNames: ["promtail"] },
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "promtail",
          "app.kubernetes.io/instance": "promtail",
        },
      },
      podMetricsEndpoints: [
        {
          port: "http-metrics",
          path: "/metrics",
          interval: "30s",
        },
      ],
    },
  });

  // Tempo's ClusterIP Service exposes Prometheus metrics on `tempo-prom-metrics` (:3200).
  new ServiceMonitor(chart, "tempo-service-monitor", {
    metadata: {
      name: "tempo-service-monitor",
      namespace: "tempo",
      labels: { release: "prometheus" },
    },
    spec: {
      namespaceSelector: { matchNames: ["tempo"] },
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "tempo",
          "app.kubernetes.io/instance": "tempo",
        },
      },
      endpoints: [
        {
          port: "tempo-prom-metrics",
          path: "/metrics",
          interval: "30s",
        },
      ],
    },
  });

  // Pyroscope's `pyroscope` and `pyroscope-headless` Services carry identical
  // labels when chart ServiceMonitors are off; PodMonitor scrapes the
  // StatefulSet pods once on `http2` (:4040/metrics) without duplicate targets.
  new PodMonitor(chart, "pyroscope-pod-monitor", {
    metadata: {
      name: "pyroscope",
      namespace: "pyroscope",
      labels: { release: "prometheus" },
    },
    spec: {
      namespaceSelector: { matchNames: ["pyroscope"] },
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "pyroscope",
          "app.kubernetes.io/instance": "pyroscope",
          "app.kubernetes.io/component": "all",
        },
      },
      podMetricsEndpoints: [
        {
          port: "http2",
          path: "/metrics",
          interval: "30s",
        },
      ],
    },
  });

  // cloudflare-operator deploys cloudflared with `--metrics 0.0.0.0:2000` and
  // container port `metrics` (:2000) without a Service.
  new PodMonitor(chart, "cloudflared-pod-monitor", {
    metadata: {
      name: "cloudflared",
      namespace: "cloudflare-operator-system",
      labels: { release: "prometheus" },
    },
    spec: {
      namespaceSelector: { matchNames: ["cloudflare-operator-system"] },
      selector: {
        matchLabels: {
          "cfargotunnel.com/app": "cloudflared",
          "cfargotunnel.com/tunnel": platformModel.cloudflareTunnel.name,
        },
      },
      podMetricsEndpoints: [
        {
          port: "metrics",
          path: "/metrics",
          interval: "30s",
        },
      ],
    },
  });
}
