import { App, Chart, Testing } from "cdk8s";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createObservabilityScrapers } from "./observability-scrapers.ts";

const MonitorMetadataSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  labels: z.object({ release: z.literal("prometheus") }),
});

const NamespaceSelectorSchema = z.object({
  matchNames: z.array(z.string()),
});

const MatchExpressionSchema = z.object({
  key: z.string(),
  operator: z.string(),
  values: z.array(z.string()).optional(),
});

const MonitorEndpointSchema = z.object({
  port: z.string(),
  path: z.string(),
  interval: z.string(),
});

const ServiceMonitorSchema = z.object({
  kind: z.literal("ServiceMonitor"),
  metadata: MonitorMetadataSchema,
  spec: z.object({
    namespaceSelector: NamespaceSelectorSchema,
    selector: z.object({
      matchLabels: z.record(z.string(), z.string()),
      matchExpressions: z.array(MatchExpressionSchema).optional(),
    }),
    endpoints: z.array(MonitorEndpointSchema),
  }),
});

const PodMonitorSchema = z.object({
  kind: z.literal("PodMonitor"),
  metadata: MonitorMetadataSchema,
  spec: z.object({
    namespaceSelector: NamespaceSelectorSchema,
    selector: z.object({
      matchLabels: z.record(z.string(), z.string()),
    }),
    podMetricsEndpoints: z.array(MonitorEndpointSchema),
  }),
});

function expectedServiceMonitor(options: {
  name: string;
  namespace: string;
  matchLabels: Record<string, string>;
  port: string;
  matchExpressions?: z.infer<typeof MatchExpressionSchema>[];
}) {
  return {
    kind: "ServiceMonitor" as const,
    metadata: {
      name: options.name,
      namespace: options.namespace,
      labels: { release: "prometheus" as const },
    },
    spec: {
      namespaceSelector: { matchNames: [options.namespace] },
      selector: {
        matchLabels: options.matchLabels,
        ...(options.matchExpressions === undefined
          ? {}
          : { matchExpressions: options.matchExpressions }),
      },
      endpoints: [{ port: options.port, path: "/metrics", interval: "30s" }],
    },
  };
}

function expectedPodMonitor(options: {
  name: string;
  namespace: string;
  matchLabels: Record<string, string>;
  port: string;
}) {
  return {
    kind: "PodMonitor" as const,
    metadata: {
      name: options.name,
      namespace: options.namespace,
      labels: { release: "prometheus" as const },
    },
    spec: {
      namespaceSelector: { matchNames: [options.namespace] },
      selector: { matchLabels: options.matchLabels },
      podMetricsEndpoints: [
        { port: options.port, path: "/metrics", interval: "30s" },
      ],
    },
  };
}

describe("createObservabilityScrapers", () => {
  test("renders Prometheus-selected monitors for Loki, Promtail, Tempo, Pyroscope, and cloudflared", () => {
    const chart = new Chart(new App(), "scrapers");
    createObservabilityScrapers(chart);
    const manifests = Testing.synth(chart);

    const serviceMonitors = manifests
      .map((manifest) => ServiceMonitorSchema.safeParse(manifest))
      .filter((result) => result.success)
      .map((result) => result.data);
    const podMonitors = manifests
      .map((manifest) => PodMonitorSchema.safeParse(manifest))
      .filter((result) => result.success)
      .map((result) => result.data);

    expect(serviceMonitors).toEqual([
      expectedServiceMonitor({
        name: "loki-service-monitor",
        namespace: "loki",
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
        port: "http-metrics",
      }),
      expectedServiceMonitor({
        name: "tempo-service-monitor",
        namespace: "tempo",
        matchLabels: {
          "app.kubernetes.io/name": "tempo",
          "app.kubernetes.io/instance": "tempo",
        },
        port: "tempo-prom-metrics",
      }),
    ]);

    expect(podMonitors).toEqual([
      expectedPodMonitor({
        name: "promtail",
        namespace: "promtail",
        matchLabels: {
          "app.kubernetes.io/name": "promtail",
          "app.kubernetes.io/instance": "promtail",
        },
        port: "http-metrics",
      }),
      expectedPodMonitor({
        name: "pyroscope",
        namespace: "pyroscope",
        matchLabels: {
          "app.kubernetes.io/name": "pyroscope",
          "app.kubernetes.io/instance": "pyroscope",
          "app.kubernetes.io/component": "all",
        },
        port: "http2",
      }),
      expectedPodMonitor({
        name: "cloudflared",
        namespace: "cloudflare-operator-system",
        matchLabels: {
          "cfargotunnel.com/app": "cloudflared",
          "cfargotunnel.com/tunnel": "homelab-tunnel",
        },
        port: "metrics",
      }),
    ]);
  });
});
