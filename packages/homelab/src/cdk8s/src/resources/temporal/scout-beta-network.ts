import type { Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

export function createTemporalScoutBetaNetworkPolicy(chart: Chart): void {
  new KubeNetworkPolicy(chart, "temporal-worker-scout-beta-netpol", {
    metadata: { name: "temporal-worker-scout-beta-netpol" },
    spec: {
      podSelector: {
        matchLabels: {
          app: "temporal-worker",
          component: "legacy-worker",
        },
      },
      policyTypes: ["Egress"],
      egress: [
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "scout-beta",
                },
              },
              podSelector: { matchLabels: { app: "scout-backend" } },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(3000), protocol: "TCP" }],
        },
      ],
    },
  });
}
