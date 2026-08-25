import type { Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

export function createTemporalScoutBetaNetworkPolicy(chart: Chart): void {
  const egress = (constructId: string, name: string, component: string) =>
    new KubeNetworkPolicy(chart, constructId, {
      metadata: { name },
      spec: {
        podSelector: { matchLabels: { component } },
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

  egress(
    "temporal-worker-scout-beta-netpol",
    "temporal-worker-scout-beta-netpol",
    "scout-worker",
  );
  egress(
    "temporal-legacy-worker-scout-beta-netpol",
    "temporal-legacy-worker-scout-beta-netpol",
    "legacy-worker",
  );
}
