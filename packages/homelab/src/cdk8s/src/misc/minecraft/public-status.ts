import type { Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
  KubeService,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

/** Query stays private; neither this service nor polling traverses mc-router. */
export function createMinecraftPublicStatus(chart: Chart): void {
  const selector = {
    "app.kubernetes.io/instance": "minecraft-tsmc",
    "app.kubernetes.io/name": "minecraft",
  };
  const ports = [
    { name: "query", port: 25_565 },
    { name: "bedrock", port: 19_132 },
  ].map((value) => ({ ...value, protocol: "UDP" }));
  new KubeService(chart, "minecraft-tsmc-status", {
    metadata: { name: "minecraft-tsmc-status", namespace: "minecraft-tsmc" },
    spec: { type: "ClusterIP", selector, ports },
  });
  new KubeNetworkPolicy(chart, "minecraft-tsmc-query", {
    metadata: { name: "minecraft-tsmc-query", namespace: "minecraft-tsmc" },
    spec: {
      podSelector: { matchLabels: selector },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: ["storm-forum", "storm-forum-beta"].map((name) => ({
            namespaceSelector: {
              matchLabels: { "kubernetes.io/metadata.name": name },
            },
            podSelector: {
              matchLabels: { app: "storm-forum", component: "web" },
            },
          })),
          ports: [{ protocol: "UDP", port: IntOrString.fromNumber(25_565) }],
        },
      ],
    },
  });
}
