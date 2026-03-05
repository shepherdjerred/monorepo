import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createStatusPageDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/status-page/index.ts";

export function createStatusPageChart(app: App) {
  const chart = new Chart(app, "status-page", {
    namespace: "status-page",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "status-page-namespace", {
    metadata: {
      name: "status-page",
    },
  });

  createStatusPageDeployment(chart);

  // NetworkPolicy: Allow ingress from Cloudflare Tunnel
  new KubeNetworkPolicy(chart, "status-page-ingress-netpol", {
    metadata: { name: "status-page-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
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
        },
      ],
    },
  });

  // NetworkPolicy: Allow egress to DNS and external HTTPS
  new KubeNetworkPolicy(chart, "status-page-egress-netpol", {
    metadata: { name: "status-page-egress-netpol" },
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
        // External HTTPS
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }],
        },
      ],
    },
  });
}
