import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createPinchtabDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/pinchtab/index.ts";
import { dnsEgressRule } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

const PINCHTAB_PORT = 9867;

export function createPinchtabChart(app: App) {
  const chart = new Chart(app, "pinchtab", {
    namespace: "pinchtab",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "pinchtab-namespace", {
    metadata: {
      name: "pinchtab",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/audit": "restricted",
        "pod-security.kubernetes.io/warn": "restricted",
      },
    },
  });

  createPinchtabDeployment(chart);

  // NetworkPolicy: allow ingress from birmel, Bazarr, and Tailscale
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
                matchLabels: { "kubernetes.io/metadata.name": "media" },
              },
              podSelector: { matchLabels: { app: "bazarr" } },
            },
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
        // Allow blackbox-exporter's in-cluster health probe (pinchtab port
        // only — not every port on the pod)
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
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

  // NetworkPolicy documents the same HTTPS-only public browsing boundary that
  // the pod-local firewall enforces for the current Flannel CNI.
  new KubeNetworkPolicy(chart, "pinchtab-egress-netpol", {
    metadata: { name: "pinchtab-egress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [
        // DNS
        dnsEgressRule(),
        // External HTTPS for public browsing.
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }],
        },
      ],
    },
  });
}
