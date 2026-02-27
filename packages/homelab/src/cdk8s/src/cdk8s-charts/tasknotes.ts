import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createTasknotesDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/tasknotes/index.ts";

export function createTasknotesChart(app: App) {
  const chart = new Chart(app, "tasknotes", {
    namespace: "tasknotes",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "tasknotes-namespace", {
    metadata: {
      name: "tasknotes",
    },
  });

  createTasknotesDeployment(chart);

  // NetworkPolicy: Allow ingress from Tailscale (mobile app via Tailscale)
  new KubeNetworkPolicy(chart, "tasknotes-ingress-netpol", {
    metadata: { name: "tasknotes-ingress-netpol" },
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

  // NetworkPolicy: Allow egress to DNS and external HTTPS (Obsidian sync servers)
  new KubeNetworkPolicy(chart, "tasknotes-egress-netpol", {
    metadata: { name: "tasknotes-egress-netpol" },
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
        // External HTTPS (api.obsidian.md, sync-N.obsidian.md WebSocket)
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }],
        },
      ],
    },
  });
}
