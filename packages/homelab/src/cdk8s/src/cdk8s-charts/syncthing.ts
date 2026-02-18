import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { KubeNetworkPolicy, IntOrString } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createSyncthingDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/syncthing.ts";

export function createSyncthingChart(app: App) {
  const chart = new Chart(app, "syncthing", {
    namespace: "syncthing",
    disableResourceNameHashes: true,
  });

  createSyncthingDeployment(chart);

  // NetworkPolicy: Allow ingress from Tailscale only
  new KubeNetworkPolicy(chart, "syncthing-ingress-netpol", {
    metadata: { name: "syncthing-ingress-netpol" },
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

  // NetworkPolicy: Allow egress to DNS and Syncthing protocols
  new KubeNetworkPolicy(chart, "syncthing-egress-netpol", {
    metadata: { name: "syncthing-egress-netpol" },
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
        // Syncthing protocols + global discovery/relay servers
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [
            { port: IntOrString.fromNumber(22_000), protocol: "TCP" }, // BEP sync
            { port: IntOrString.fromNumber(22_000), protocol: "UDP" }, // QUIC sync
            { port: IntOrString.fromNumber(21_027), protocol: "UDP" }, // Local discovery
            { port: IntOrString.fromNumber(443), protocol: "TCP" }, // Global discovery + relays
          ],
        },
      ],
    },
  });
}
