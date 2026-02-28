import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createSentinelDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/sentinel/index.ts";

export function createSentinelChart(app: App) {
  const chart = new Chart(app, "sentinel", {
    namespace: "sentinel",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "sentinel-namespace", {
    metadata: {
      name: "sentinel",
    },
  });

  createSentinelDeployment(chart);

  // NetworkPolicy: Allow ingress from Tailscale and Cloudflare Tunnel
  new KubeNetworkPolicy(chart, "sentinel-ingress-netpol", {
    metadata: { name: "sentinel-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tailscale" },
              },
            },
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "cloudflare-tunnel" },
              },
            },
          ],
        },
      ],
    },
  });

  // NetworkPolicy: Allow egress to DNS, Tempo (OTLP), and external HTTPS
  new KubeNetworkPolicy(chart, "sentinel-egress-netpol", {
    metadata: { name: "sentinel-egress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [
        // DNS
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
        // Tempo OTLP (tempo.tempo.svc.cluster.local:4318)
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
        // External HTTPS (Anthropic, Discord, GitHub, Sentry, PagerDuty)
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }],
        },
        // Talos API (talosctl health via port 50000)
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: IntOrString.fromNumber(50_000), protocol: "TCP" }],
        },
      ],
    },
  });
}
