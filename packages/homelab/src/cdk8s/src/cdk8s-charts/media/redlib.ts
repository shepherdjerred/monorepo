import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createRedlibDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/frontends/redlib.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  tailscaleIngressRule,
  blackboxProbeIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

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
      ingress: [
        tailscaleIngressRule(),
        // Allow blackbox-exporter's in-cluster health probe (service port
        // only — not every port on the pod)
        blackboxProbeIngressRule(8080),
      ],
    },
  });

  // NetworkPolicy: Allow egress to DNS and HTTPS only (Reddit API and CDNs all use HTTPS)
  new KubeNetworkPolicy(chart, "redlib-egress-netpol", {
    metadata: { name: "redlib-egress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [
        dnsEgressRule(),
        // HTTPS only (Reddit API and all CDNs use HTTPS)
        externalHttpsEgressRule(),
      ],
    },
  });
}
