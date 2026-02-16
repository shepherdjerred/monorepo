import { App, Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { KubeNetworkPolicy, IntOrString } from "../../generated/imports/k8s.ts";
import { createRedlibDeployment } from "../resources/frontends/redlib.ts";

export function createRedlibChart(app: App) {
  const chart = new Chart(app, "redlib", {
    namespace: "redlib",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "redlib-namespace", {
    metadata: {
      name: "redlib",
    },
  });

  createRedlibDeployment(chart);

  // NetworkPolicy: Allow ingress from Tailscale only
  new KubeNetworkPolicy(chart, "redlib-ingress-netpol", {
    metadata: { name: "redlib-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [{ from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "tailscale" } } }] }],
    },
  });

  // NetworkPolicy: Allow egress to DNS and HTTPS only (Reddit API and CDNs all use HTTPS)
  new KubeNetworkPolicy(chart, "redlib-egress-netpol", {
    metadata: { name: "redlib-egress-netpol" },
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
        // HTTPS only (Reddit API and all CDNs use HTTPS)
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }],
        },
      ],
    },
  });
}
