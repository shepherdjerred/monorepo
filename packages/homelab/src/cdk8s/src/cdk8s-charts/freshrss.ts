import { App, Chart } from "cdk8s";
import { KubeNetworkPolicy, IntOrString } from "../../generated/imports/k8s.ts";
import { createFreshRssDeployment } from "../resources/freshrss.ts";

export function createFreshRssChart(app: App) {
  const chart = new Chart(app, "freshrss", {
    namespace: "freshrss",
    disableResourceNameHashes: true,
  });

  createFreshRssDeployment(chart);

  // NetworkPolicy: Allow ingress from Tailscale and Cloudflare tunnel
  new KubeNetworkPolicy(chart, "freshrss-ingress-netpol", {
    metadata: { name: "freshrss-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        { from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "tailscale" } } }] },
        { from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "cloudflare-tunnel" } } }] },
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
        {
          to: [{ namespaceSelector: {}, podSelector: { matchLabels: { "k8s-app": "kube-dns" } } }],
          ports: [
            { port: IntOrString.fromNumber(53), protocol: "UDP" },
            { port: IntOrString.fromNumber(53), protocol: "TCP" },
          ],
        },
        // HTTP and HTTPS for RSS feeds (many feeds still use HTTP)
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
