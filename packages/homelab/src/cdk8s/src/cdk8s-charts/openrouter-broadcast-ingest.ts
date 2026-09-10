import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  BROADCAST_METRICS_PORT,
  BROADCAST_PORT,
  createOpenRouterBroadcastIngestDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/openrouter-broadcast-ingest/index.ts";

export function createOpenRouterBroadcastIngestChart(app: App) {
  const chart = new Chart(app, "openrouter-broadcast-ingest", {
    namespace: "openrouter-broadcast-ingest",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "openrouter-broadcast-ingest-namespace", {
    metadata: {
      name: "openrouter-broadcast-ingest",
      labels: {
        "pod-security.kubernetes.io/enforce": "restricted",
      },
    },
  });

  createOpenRouterBroadcastIngestDeployment(chart);

  new KubeNetworkPolicy(chart, "openrouter-broadcast-ingest-netpol", {
    metadata: { name: "openrouter-broadcast-ingest-netpol" },
    spec: {
      podSelector: { matchLabels: { app: "openrouter-broadcast-ingest" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "cloudflare-tunnel",
                },
              },
            },
          ],
          ports: [
            {
              port: IntOrString.fromNumber(BROADCAST_PORT),
              protocol: "TCP",
            },
          ],
        },
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "prometheus",
                },
              },
            },
          ],
          ports: [
            {
              port: IntOrString.fromNumber(BROADCAST_PORT),
              protocol: "TCP",
            },
            {
              port: IntOrString.fromNumber(BROADCAST_METRICS_PORT),
              protocol: "TCP",
            },
          ],
        },
      ],
      egress: [
        {
          to: [
            {
              namespaceSelector: {},
              podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(53), protocol: "UDP" },
            { port: IntOrString.fromNumber(53), protocol: "TCP" },
          ],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "seaweedfs",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(8333), protocol: "TCP" }],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tempo" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(4318), protocol: "TCP" }],
        },
      ],
    },
  });

  return chart;
}
