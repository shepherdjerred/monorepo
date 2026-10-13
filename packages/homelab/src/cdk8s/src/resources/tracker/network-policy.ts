import type { Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { postgresClusterPodLabels } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/cluster-label.ts";

const namespace = (name: string) => ({
  namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": name } },
});
const tcp = (port: number) => ({
  port: IntOrString.fromNumber(port),
  protocol: "TCP",
});

export function createTrackerNetworkPolicy(chart: Chart) {
  new KubeNetworkPolicy(chart, "tracker-app-netpol", {
    metadata: { name: "tracker-app-netpol" },
    spec: {
      podSelector: { matchLabels: { app: "tracker" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [namespace("tailscale"), namespace("prometheus")],
          ports: [tcp(7351)],
        },
        {
          from: [
            {
              ...namespace("temporal"),
              podSelector: { matchLabels: { component: "infra-worker" } },
            },
          ],
          ports: [tcp(7351)],
        },
      ],
      egress: [
        {
          to: [
            {
              namespaceSelector: {},
              podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(53), protocol: "UDP" },
            tcp(53),
          ],
        },
        {
          to: [
            {
              podSelector: {
                matchLabels: postgresClusterPodLabels("tracker-postgresql"),
              },
            },
          ],
          ports: [tcp(5432)],
        },
        { to: [namespace("seaweedfs")], ports: [tcp(8333)] },
        { to: [namespace("flipt")], ports: [tcp(8080)] },
        { to: [namespace("alloy-gateway")], ports: [tcp(4318)] },
      ],
    },
  });
}
