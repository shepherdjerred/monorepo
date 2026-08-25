import type { Chart } from "cdk8s";
import { Pods, Service } from "cdk8s-plus-31";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";

export function createTemporalLegacyWorkerMetrics(chart: Chart): void {
  const selector = Pods.select(chart, "temporal-legacy-worker-selector", {
    labels: { component: "legacy-worker" },
  });
  new Service(chart, "temporal-worker-metrics-service", {
    selector,
    metadata: { labels: { component: "legacy-worker-metrics" } },
    ports: [{ port: 9464, name: "metrics" }],
  });
  createServiceMonitor(chart, {
    name: "temporal-worker-metrics",
    matchLabels: { component: "legacy-worker-metrics" },
  });

  new Service(chart, "temporal-worker-app-metrics-service", {
    metadata: {
      name: "temporal-worker-app-metrics",
      labels: { component: "legacy-worker-app-metrics" },
    },
    selector,
    ports: [{ name: "app-metrics", port: 9465, targetPort: 9465 }],
  });
  createServiceMonitor(chart, {
    name: "temporal-worker-app-metrics",
    port: "app-metrics",
    interval: "30s",
    matchLabels: { component: "legacy-worker-app-metrics" },
  });
}
