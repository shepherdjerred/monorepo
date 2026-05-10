import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  createTrmnlDashboardDeployment,
  trmnlDashboardPorts,
} from "@shepherdjerred/homelab/cdk8s/src/resources/trmnl-dashboard/index.ts";

export function createTrmnlDashboardChart(app: App) {
  const chart = new Chart(app, "trmnl-dashboard", {
    namespace: "trmnl-dashboard",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "trmnl-dashboard-namespace", {
    metadata: {
      name: "trmnl-dashboard",
    },
  });

  createTrmnlDashboardDeployment(chart);

  new KubeNetworkPolicy(chart, "trmnl-dashboard-ingress-netpol", {
    metadata: { name: "trmnl-dashboard-ingress-netpol" },
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
          ports: [{ port: IntOrString.fromNumber(3000), protocol: "TCP" }],
        },
      ],
    },
  });

  new KubeNetworkPolicy(chart, "trmnl-dashboard-egress-netpol", {
    metadata: { name: "trmnl-dashboard-egress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [
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
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: trmnlDashboardPorts,
        },
      ],
    },
  });
}
