import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  createTrmnlDashboardDeployment,
  trmnlDashboardPorts,
} from "@shepherdjerred/homelab/cdk8s/src/resources/trmnl-dashboard/index.ts";
import {
  dnsEgressRule,
  nsPeer,
  tcp,
  cloudflareTunnelIngressRule,
  blackboxProbeIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

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
        cloudflareTunnelIngressRule([3000]),
        // Allow blackbox-exporter's in-cluster health probe
        blackboxProbeIngressRule(3000),
      ],
    },
  });

  new KubeNetworkPolicy(chart, "trmnl-dashboard-egress-netpol", {
    metadata: { name: "trmnl-dashboard-egress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [
        dnsEgressRule(),
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: trmnlDashboardPorts,
        },
        {
          // The ops snapshot behind /api/homelab.
          to: [nsPeer("alert-dashboard")],
          ports: [tcp(7341)],
        },
      ],
    },
  });
}
