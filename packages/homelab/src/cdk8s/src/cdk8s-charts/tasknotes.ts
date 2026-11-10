import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createTasknotesDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/tasknotes/index.ts";
import {
  dnsEgressRule,
  tailscaleIngressRule,
  externalHttpsEgressRule,
  blackboxProbeIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export function createTasknotesChart(app: App) {
  const chart = new Chart(app, "tasknotes", {
    namespace: "tasknotes",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "tasknotes-namespace", {
    metadata: {
      name: "tasknotes",
    },
  });

  createTasknotesDeployment(chart);

  // NetworkPolicy: Allow ingress from Tailscale (mobile app via Tailscale)
  new KubeNetworkPolicy(chart, "tasknotes-ingress-netpol", {
    metadata: { name: "tasknotes-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        tailscaleIngressRule(),
        // Allow blackbox-exporter's in-cluster health probe (http service port
        // only — not every port on the pod)
        blackboxProbeIngressRule(3000),
      ],
    },
  });

  // NetworkPolicy: Allow egress to DNS and external HTTPS (Obsidian sync servers)
  new KubeNetworkPolicy(chart, "tasknotes-egress-netpol", {
    metadata: { name: "tasknotes-egress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [
        // DNS
        dnsEgressRule(),
        // External HTTPS (api.obsidian.md, sync-N.obsidian.md WebSocket)
        externalHttpsEgressRule(),
      ],
    },
  });
}
