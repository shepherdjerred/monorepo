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
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

const port = (number: number) => ({
  port: IntOrString.fromNumber(number),
  protocol: "TCP",
});
const namespace = (name: string) => ({
  namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": name } },
});

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
          ports: [port(3306)],
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
            namespace(
              stage === "beta" ? "tailscale" : "cloudflare-operator-system",
            ),
          ],
          ports: [port(8080)],
        },
        { from: [namespace("tailscale")], ports: [port(8081)] },
        { from: [namespace("prometheus")], ports: [port(8080), port(8081)] },
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
          podSelector: {
            matchLabels: { app: "storm-forum", component: "database" },
          },
        },
      ],
      ports: [port(3306)],
    },
    ...[
      ["seaweedfs", 8333],
      ["postal", 25],
      ["temporal", 7233],
      ["flipt", 8080],
      ["minecraft-tsmc", 25_565],
    ].map(([name, number]) => ({
      to: [namespace(String(name))],
      ports: [port(Number(number))],
    })),
  ];
}
