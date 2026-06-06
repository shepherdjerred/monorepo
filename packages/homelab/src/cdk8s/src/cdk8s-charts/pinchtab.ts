import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createPinchtabDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/pinchtab/index.ts";

const PINCHTAB_PORT = 9867;

export function createPinchtabChart(app: App) {
  const chart = new Chart(app, "pinchtab", {
    namespace: "pinchtab",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "pinchtab-namespace", {
    metadata: {
      name: "pinchtab",
    },
  });

  createPinchtabDeployment(chart);

  // NetworkPolicy: allow ingress from birmel (the only consumer) and Tailscale
  // (dashboard/API access via TailscaleIngress) on the pinchtab port.
  new KubeNetworkPolicy(chart, "pinchtab-ingress-netpol", {
    metadata: { name: "pinchtab-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "birmel" },
              },
            },
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tailscale" },
              },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(PINCHTAB_PORT), protocol: "TCP" },
          ],
        },
      ],
    },
  });

  // NetworkPolicy: allow egress to DNS and the open internet (HTTP/HTTPS) so the
  // browser can navigate to arbitrary sites.
  new KubeNetworkPolicy(chart, "pinchtab-egress-netpol", {
    metadata: { name: "pinchtab-egress-netpol" },
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
        // External HTTP/HTTPS for arbitrary browsing.
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [
            { port: IntOrString.fromNumber(80), protocol: "TCP" },
            { port: IntOrString.fromNumber(443), protocol: "TCP" },
          ],
        },
      ],
    },
  });
}
