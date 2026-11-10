import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createFreshRssDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/freshrss/freshrss.ts";
import {
  dnsEgressRule,
  tcp,
  tailscaleIngressRule,
  cloudflareTunnelIngressRule,
  blackboxProbeIngressRule,
  nsPeer,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export async function createFreshRssChart(app: App): Promise<void> {
  const chart = new Chart(app, "freshrss", {
    namespace: "freshrss",
    disableResourceNameHashes: true,
  });

  await createFreshRssDeployment(chart);

  // NetworkPolicy: Allow ingress from Tailscale and Cloudflare tunnel
  new KubeNetworkPolicy(chart, "freshrss-ingress-netpol", {
    metadata: { name: "freshrss-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              ...nsPeer("temporal"),
              podSelector: {
                matchLabels: {
                  component: "repo-worker",
                },
              },
            },
          ],
          ports: [tcp(80)],
        },
        tailscaleIngressRule(),
        cloudflareTunnelIngressRule(),
        // Allow blackbox-exporter's in-cluster health probe (service port
        // only — not every port on the pod)
        blackboxProbeIngressRule(80),
      ],
    },
  });

  // NetworkPolicy: Allow egress to DNS and HTTP/HTTPS (RSS feeds can be either)
  new KubeNetworkPolicy(chart, "freshrss-egress-netpol", {
    metadata: { name: "freshrss-egress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [
        // DNS
        dnsEgressRule(),
        // HTTP and HTTPS for RSS feeds (many feeds still use HTTP)
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [tcp(80), tcp(443)],
        },
      ],
    },
  });
}
