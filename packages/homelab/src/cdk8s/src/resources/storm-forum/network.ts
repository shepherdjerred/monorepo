import type { Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  nsPeer,
  cloudflareTunnelPeer,
  tcp,
  tailscaleIngressRule,
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export function createForumNetwork(chart: Chart, stage: "beta" | "prod"): void {
  new KubeNetworkPolicy(chart, "database-network", {
    spec: {
      podSelector: {
        matchLabels: { app: "storm-forum", component: "database" },
      },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [
            {
              podSelector: {
                matchLabels: { app: "storm-forum", component: "web" },
              },
            },
            {
              podSelector: {
                matchLabels: { app: "storm-forum", component: "release" },
              },
            },
          ],
          ports: [tcp(3306)],
        },
      ],
      egress: [dnsEgressRule()],
    },
  });
  new KubeNetworkPolicy(chart, "forum-network", {
    spec: {
      podSelector: { matchLabels: { app: "storm-forum", component: "web" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [
            stage === "beta" ? nsPeer("tailscale") : cloudflareTunnelPeer(),
          ],
          ports: [tcp(8080)],
        },
        tailscaleIngressRule([8081]),
        prometheusIngressRule([8080, 8081]),
        {
          from: [
            {
              ...nsPeer("delivery"),
              podSelector: { matchLabels: { app: "delivery" } },
            },
          ],
          ports: [tcp(8082)],
        },
      ],
      egress: forumEgress(),
    },
  });
  new KubeNetworkPolicy(chart, "release-network", {
    spec: {
      podSelector: {
        matchLabels: { app: "storm-forum", component: "release" },
      },
      policyTypes: ["Ingress", "Egress"],
      ingress: [],
      egress: forumEgress(),
    },
  });
  // Only GET this exact StatefulSet. No list, scale, patch or router access.
  const name = `storm-forum-${stage}-status`;
  new KubeRole(chart, "minecraft-status-role", {
    metadata: { name, namespace: "minecraft-tsmc" },
    rules: [
      {
        apiGroups: ["apps"],
        resources: ["statefulsets"],
        resourceNames: ["minecraft-tsmc"],
        verbs: ["get"],
      },
    ],
  });
  new KubeRoleBinding(chart, "minecraft-status-binding", {
    metadata: { name, namespace: "minecraft-tsmc" },
    roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name },
    subjects: [
      {
        kind: "ServiceAccount",
        name: "storm-forum-worker",
        namespace: chart.namespace,
      },
    ],
  });
}

function forumEgress() {
  return [
    dnsEgressRule(),
    externalHttpsEgressRule(),
    {
      to: [
        {
          ...nsPeer("minecraft-tsmc"),
          podSelector: {
            matchLabels: {
              "app.kubernetes.io/instance": "minecraft-tsmc",
              "app.kubernetes.io/name": "minecraft",
            },
          },
        },
      ],
      ports: [25_565, 19_132].map((number) => ({
        port: IntOrString.fromNumber(number),
        protocol: "UDP",
      })),
    },
    {
      to: [
        {
          podSelector: {
            matchLabels: { app: "storm-forum", component: "database" },
          },
        },
      ],
      ports: [tcp(3306)],
    },
    ...[
      ["seaweedfs", 8333],
      ["postal", 25],
      ["temporal", 7233],
      ["flipt", 8080],
    ].map(([name, number]) => ({
      to: [nsPeer(String(name))],
      ports: [tcp(Number(number))],
    })),
  ];
}
