import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createHomeAssistantDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/home/homeassistant.ts";
import { createEufySecurityWsDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/home/eufy-security-ws.ts";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

export async function createHomeChart(app: App) {
  const chart = new Chart(app, "home", {
    namespace: "home",
    disableResourceNameHashes: true,
  });

  await createHomeAssistantDeployment(chart);
  createEufySecurityWsDeployment(chart);

  // NetworkPolicy: Allow ingress to home namespace from Tailscale, Cloudflare tunnel, and LAN
  // Note: homeassistant uses hostNetwork — whether NetworkPolicies apply depends on the CNI plugin.
  // Cilium does enforce policies on hostNetwork pods, so this policy affects all pods in the namespace.
  new KubeNetworkPolicy(chart, "home-ingress-policy", {
    metadata: { name: "home-ingress-policy" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        // Allow from Tailscale (private access)
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tailscale" },
              },
            },
          ],
        },
        // Allow from Cloudflare tunnel (public access)
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
        // Allow Prometheus scraping from monitoring namespace
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
        },
        // Allow HomeKit from LAN (mDNS discovery + bridge ports)
        {
          from: [{ ipBlock: { cidr: "192.168.1.0/24" } }],
          ports: [
            { port: IntOrString.fromNumber(5353), protocol: "UDP" },
            { port: IntOrString.fromNumber(21_063), protocol: "TCP" },
            { port: IntOrString.fromNumber(21_064), protocol: "TCP" },
          ],
        },
      ],
    },
  });

  // NetworkPolicy: Allow eufy-security-ws egress to DNS and external (Eufy cloud + P2P)
  new KubeNetworkPolicy(chart, "eufy-security-ws-egress-policy", {
    metadata: { name: "eufy-security-ws-egress-policy" },
    spec: {
      podSelector: { matchLabels: { app: "eufy-security-ws" } },
      policyTypes: ["Egress"],
      egress: [
        // Allow DNS
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
        // Allow external HTTPS (Eufy cloud API)
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }],
        },
        // Allow all UDP egress (any port, any destination) for Eufy P2P.
        // Eufy stations perform NAT traversal with dynamic ephemeral ports on
        // both ends, so neither the destination IP nor port can be enumerated
        // ahead of time. This is the broadest egress rule on the pod -- the
        // P2P protocol requires it, and it is an accepted trade-off.
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ protocol: "UDP" }],
        },
      ],
    },
  });
}
