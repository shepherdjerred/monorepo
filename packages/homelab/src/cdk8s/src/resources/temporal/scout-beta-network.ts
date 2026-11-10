import type { Chart } from "cdk8s";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  tcp,
  nsPeer,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

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
                ...nsPeer("scout-beta"),
                podSelector: { matchLabels: { app: "scout-backend" } },
              },
            ],
            ports: [tcp(3000)],
          },
        ],
      },
    });

  egress(
    "temporal-worker-scout-beta-netpol",
    "temporal-worker-scout-beta-netpol",
    "scout-worker",
  );
}
