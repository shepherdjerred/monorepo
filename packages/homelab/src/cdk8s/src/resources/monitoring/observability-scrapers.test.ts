import { App, Chart, Testing } from "cdk8s";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createObservabilityScrapers } from "./observability-scrapers.ts";

const ServiceMonitorSchema = z.object({
  kind: z.literal("ServiceMonitor"),
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
    labels: z.object({ release: z.literal("prometheus") }),
  }),
  spec: z.object({
    namespaceSelector: z.object({ matchNames: z.array(z.string()) }),
    selector: z.object({
      matchLabels: z.record(z.string(), z.string()),
      matchExpressions: z
        .array(
          z.object({
            key: z.string(),
            operator: z.string(),
            values: z.array(z.string()).optional(),
          }),
        )
        .optional(),
    }),
    endpoints: z.array(
      z.object({
        port: z.string(),
        path: z.string(),
        interval: z.string(),
      }),
    ),
  }),
});

const PodMonitorSchema = z.object({
  kind: z.literal("PodMonitor"),
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
    labels: z.object({ release: z.literal("prometheus") }),
  }),
  spec: z.object({
    namespaceSelector: z.object({ matchNames: z.array(z.string()) }),
    selector: z.object({
      matchLabels: z.record(z.string(), z.string()),
    }),
    podMetricsEndpoints: z.array(
      z.object({
        port: z.string(),
        path: z.string(),
        interval: z.string(),
      }),
    ),
  }),
});

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
      {
        kind: "ServiceMonitor",
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
            { port: "http-metrics", path: "/metrics", interval: "30s" },
          ],
        },
      },
      {
        kind: "ServiceMonitor",
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
            { port: "tempo-prom-metrics", path: "/metrics", interval: "30s" },
          ],
        },
      },
    ]);

    expect(podMonitors).toEqual([
      {
        kind: "PodMonitor",
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
            { port: "http-metrics", path: "/metrics", interval: "30s" },
          ],
        },
      },
      {
        kind: "PodMonitor",
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
            { port: "http2", path: "/metrics", interval: "30s" },
          ],
        },
      },
      {
        kind: "PodMonitor",
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
              "cfargotunnel.com/tunnel": "homelab-tunnel",
            },
          },
          podMetricsEndpoints: [
            { port: "metrics", path: "/metrics", interval: "30s" },
          ],
        },
      },
    ]);
  });
});
