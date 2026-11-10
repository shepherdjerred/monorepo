import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  BRAIN_METRICS_PORT,
  BRAIN_PORT,
  createStormBrainDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/storm-brain/index.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  nsPeer,
  tcp,
  fliptEgress,
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export function createStormBrainChart(app: App) {
  const chart = new Chart(app, "storm-brain", {
    namespace: "storm-brain",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "storm-brain-namespace", {
    metadata: {
      name: "storm-brain",
      labels: {
        "pod-security.kubernetes.io/enforce": "restricted",
      },
    },
  });

  createStormBrainDeployment(chart);

  new KubeNetworkPolicy(chart, "storm-brain-netpol", {
    metadata: { name: "storm-brain-netpol" },
    spec: {
      podSelector: { matchLabels: { app: "storm-brain" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          // The Storm game server (minecraft-tsmc), the only brain client.
          from: [nsPeer("minecraft-tsmc")],
          ports: [tcp(BRAIN_PORT)],
        },
        prometheusIngressRule([BRAIN_PORT, BRAIN_METRICS_PORT]),
      ],
      egress: [
        dnsEgressRule(),
        // Flipt evaluation (flipt-flipt-service.flipt.svc.cluster.local:8080)
        fliptEgress(),
        // External HTTPS (OpenAI API)
        externalHttpsEgressRule(),
      ],
    },
  });

  return chart;
}
