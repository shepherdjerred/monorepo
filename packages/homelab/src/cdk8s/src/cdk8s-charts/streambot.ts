import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createStreambotDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/streambot.ts";

export function createStreambotChart(app: App) {
  const chart = new Chart(app, "streambot", {
    namespace: "streambot",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "streambot-namespace", {
    metadata: {
      name: "streambot",
    },
  });

  createStreambotDeployment(chart);

  new KubeNetworkPolicy(chart, "streambot-ingress-netpol", {
    metadata: { name: "streambot-ingress-netpol" },
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
          ],
        },
      ],
    },
  });

  new KubeNetworkPolicy(chart, "streambot-egress-netpol", {
    metadata: { name: "streambot-egress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
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
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [
            { port: IntOrString.fromNumber(80), protocol: "TCP" },
            { port: IntOrString.fromNumber(443), protocol: "TCP" },
          ],
        },
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [
            {
              port: IntOrString.fromNumber(50_000),
              endPort: 65_535,
              protocol: "UDP",
            },
          ],
        },
      ],
    },
  });
}
