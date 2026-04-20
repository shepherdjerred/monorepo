import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createHomeAssistantDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/home/homeassistant.ts";
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
}
