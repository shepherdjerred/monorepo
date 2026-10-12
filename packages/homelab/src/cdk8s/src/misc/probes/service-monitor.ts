import type { Chart } from "cdk8s";
import {
  ServiceMonitor,
  type ServiceMonitorSpecEndpointsMetricRelabelings,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com.ts";

export type CreateServiceMonitorOptions = {
  /** The app name - used for construct ID, metadata name, and default matchLabels */
  name: string;
  /** Override the metadata name (default: `${name}-service-monitor`) */
  metadataName?: string;
  /** Scrape interval (default: "30s") */
  interval?: string;
  /** Metrics path (default: "/metrics") */
  path?: string;
  /** Port name to scrape (default: "metrics") */
  port?: string;
  /** Labels to match for selecting the service (default: { app: name }) */
  matchLabels?: Record<string, string>;
  /** Namespace override for cross-namespace monitoring */
  namespace?: string;
  /** Relabelings applied after the scrape, e.g. to drop unused series */
  metricRelabelings?: ServiceMonitorSpecEndpointsMetricRelabelings[];
};

/**
 * Creates a ServiceMonitor for Prometheus Operator.
 * Simplifies the common pattern of scraping /metrics endpoints.
 */
export function createServiceMonitor(
  chart: Chart,
  opts: CreateServiceMonitorOptions,
): ServiceMonitor {
  const {
    name,
    metadataName,
    interval = "30s",
    path = "/metrics",
    port = "metrics",
    matchLabels = { app: name },
    namespace,
    metricRelabelings,
  } = opts;

  const constructId = `${name}-service-monitor`;

  return new ServiceMonitor(chart, constructId, {
    metadata: {
      name: metadataName ?? constructId,
      namespace,
      labels: {
        release: "prometheus", // Required for Prometheus operator discovery
      },
    },
    spec: {
      endpoints: [
        {
          port,
          interval,
          path,
          metricRelabelings,
        },
      ],
      selector: {
        matchLabels,
      },
    },
  });
}
