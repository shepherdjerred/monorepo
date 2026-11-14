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
      egress: forumEgress("web"),
    },
  });
  new KubeNetworkPolicy(chart, "release-network", {
    spec: {
      podSelector: {
        matchLabels: { app: "storm-forum", component: "release" },
      },
      policyTypes: ["Ingress", "Egress"],
      ingress: [],
      egress: forumEgress("release"),
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

/**
 * Minecraft Query and Bedrock status over UDP. Only the web pod's activities
 * container polls the server (`storm-forum/src/minecraft.ts`), and
 * `minecraft-tsmc-query` admits only web pods; the release Job migrates the
 * forum and never opens these sockets.
 */
function minecraftStatusEgress() {
  return {
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
  };
}

/**
 * The Temporal frontend. Only the web pod's activities container is a Temporal
 * worker (`storm-forum/src/cli.ts worker`), and `temporal-server-netpol`
 * admits only web pods; the release Job never connects.
 */
function temporalEgress() {
  return { to: [nsPeer("temporal")], ports: [tcp(7233)] };
}

function forumEgress(component: "web" | "release") {
  return [
    dnsEgressRule(),
    externalHttpsEgressRule(),
    ...(component === "web" ? [minecraftStatusEgress()] : []),
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
      ["flipt", 8080],
    ].map(([name, number]) => ({
      to: [nsPeer(String(name))],
      ports: [tcp(Number(number))],
    })),
    ...(component === "web" ? [temporalEgress()] : []),
  ];
}
