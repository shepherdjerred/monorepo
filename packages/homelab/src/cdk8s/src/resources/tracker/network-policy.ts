import type { Chart } from "cdk8s";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  nsPeer,
  tcp,
  fliptEgress,
  otlpEgress,
  seaweedfsEgress,
  postgresEgress,
  dnsEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export function createTrackerNetworkPolicy(chart: Chart) {
  new KubeNetworkPolicy(chart, "tracker-app-netpol", {
    metadata: { name: "tracker-app-netpol" },
    spec: {
      podSelector: { matchLabels: { app: "tracker" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [nsPeer("tailscale"), nsPeer("prometheus")],
          ports: [tcp(7351)],
        },
        {
          from: [
            {
              ...nsPeer("temporal"),
              podSelector: { matchLabels: { component: "infra-worker" } },
            },
          ],
          ports: [tcp(7351)],
        },
      ],
      egress: [
        dnsEgressRule(),
        postgresEgress("tracker-postgresql"),
        seaweedfsEgress(),
        fliptEgress(),
        otlpEgress(),
      ],
    },
  });
}
