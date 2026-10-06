import type { Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

/** PROXY headers are trusted only on TCP ingress from the router namespace. */
export function createMinecraftProxyTrust(
  chart: Chart,
  namespace: string,
  proxyPort: number,
) {
  return new KubeNetworkPolicy(chart, `${namespace}-proxy-trust`, {
    metadata: { name: `${namespace}-proxy-trust`, namespace },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "mc-router" },
              },
              podSelector: {
                matchLabels: { "app.kubernetes.io/name": "mc-router" },
              },
            },
          ],
          ports: [{ protocol: "TCP", port: IntOrString.fromNumber(proxyPort) }],
        },
        {
          ports: [8123, 8100, 25_575, 25_580].map((port) => ({
            protocol: "TCP",
            port: IntOrString.fromNumber(port),
          })),
        },
        { ports: [{ protocol: "UDP", port: IntOrString.fromNumber(19_132) }] },
      ],
    },
  });
}
