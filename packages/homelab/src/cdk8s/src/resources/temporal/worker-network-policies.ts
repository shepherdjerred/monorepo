import type { Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createTemporalScoutBetaNetworkPolicy } from "./scout-beta-network.ts";

function metricsIngress(ports: readonly number[]) {
  return [
    {
      from: [
        {
          namespaceSelector: {
            matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
          },
        },
      ],
      ports: ports.map((port) => ({
        port: IntOrString.fromNumber(port),
        protocol: "TCP",
      })),
    },
  ];
}

function dnsEgress() {
  return {
    to: [
      {
        namespaceSelector: {},
        podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
      },
    ],
    ports: [
      { port: IntOrString.fromNumber(53), protocol: "UDP" },
      { port: IntOrString.fromNumber(53), protocol: "TCP" },
    ],
  };
}

function temporalServerEgress() {
  return {
    to: [{ podSelector: { matchLabels: { app: "temporal-server" } } }],
    ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
  };
}

function fliptEgress() {
  return {
    to: [
      {
        namespaceSelector: {
          matchLabels: { "kubernetes.io/metadata.name": "flipt" },
        },
        podSelector: { matchLabels: { app: "flipt" } },
      },
    ],
    ports: [{ port: IntOrString.fromNumber(8080), protocol: "TCP" }],
  };
}

// Every domain worker built on createTemporalDomainWorker() with
// featureFlagsEnabled left at its default (i.e. every one of these
// components) boots with temporalFeatureFlagEnvironment() so it can read the
// temporal-call-graph-tracing flag. Flipt has no auth of its own —
// reachability IS the authorization model — so this single, explicitly
// named policy is what actually scopes which workers may query it. The
// credentialless central-workflows track resolves the same flag itself (it
// is the only role that actually hosts workflow code) but keeps its own,
// narrower NetworkPolicy — see temporal-central-workflows-netpol below —
// rather than joining this component-label selector.
const FLIPT_CONSUMER_COMPONENTS = [
  "gateway",
  "home-worker",
  "reports-worker",
  "infra-worker",
  "repo-worker",
  "scout-worker",
  "glitter-corpus-worker",
  "glitter-context-worker",
  "agent-worker",
] as const;

function createTemporalWorkersFliptEgressPolicy(chart: Chart): void {
  new KubeNetworkPolicy(chart, "temporal-workers-flipt-egress", {
    metadata: { name: "temporal-workers-flipt-egress" },
    spec: {
      podSelector: {
        matchExpressions: [
          {
            key: "component",
            operator: "In",
            values: [...FLIPT_CONSUMER_COMPONENTS],
          },
        ],
      },
      policyTypes: ["Egress"],
      egress: [fliptEgress()],
    },
  });
}

export function createTemporalWorkerNetworkPolicies(chart: Chart): void {
  createTemporalWorkersFliptEgressPolicy(chart);

  new KubeNetworkPolicy(chart, "temporal-central-workflows-netpol", {
    metadata: { name: "temporal-central-workflows-netpol" },
    spec: {
      podSelector: { matchLabels: { "worker-family": "central-workflows" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: metricsIngress([9464, 9465]),
      egress: [
        dnsEgress(),
        temporalServerEgress(),
        fliptEgress(),
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tempo" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(4318), protocol: "TCP" }],
        },
      ],
    },
  });

  for (const component of [
    "gateway",
    "home-worker",
    "reports-worker",
    "infra-worker",
    "repo-worker",
    "scout-worker",
    "glitter-corpus-worker",
    "glitter-context-worker",
  ]) {
    new KubeNetworkPolicy(chart, `${component}-network-policy`, {
      metadata: { name: `temporal-${component}-netpol` },
      spec: {
        podSelector: { matchLabels: { component } },
        policyTypes: ["Ingress", "Egress"],
        ingress: metricsIngress([9464, 9465]),
        egress: [
          dnsEgress(),
          temporalServerEgress(),
          { ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }] },
          { ports: [{ port: IntOrString.fromNumber(4318), protocol: "TCP" }] },
        ],
      },
    });
  }

  new KubeNetworkPolicy(chart, "temporal-gateway-ingress-netpol", {
    metadata: { name: "temporal-gateway-ingress-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "gateway" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "cloudflare-tunnel",
                },
              },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(9466), protocol: "TCP" },
            { port: IntOrString.fromNumber(9467), protocol: "TCP" },
            { port: IntOrString.fromNumber(9468), protocol: "TCP" },
            { port: IntOrString.fromNumber(9469), protocol: "TCP" },
          ],
        },
      ],
      egress: [
        { ports: [{ port: IntOrString.fromNumber(9093), protocol: "TCP" }] },
      ],
    },
  });

  new KubeNetworkPolicy(chart, "temporal-reports-internal-netpol", {
    metadata: { name: "temporal-reports-internal-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "reports-worker" } },
      policyTypes: ["Egress"],
      egress: [
        { ports: [{ port: IntOrString.fromNumber(5000), protocol: "TCP" }] },
        { ports: [{ port: IntOrString.fromNumber(9093), protocol: "TCP" }] },
      ],
    },
  });

  new KubeNetworkPolicy(chart, "temporal-repo-alertmanager-netpol", {
    metadata: { name: "temporal-repo-alertmanager-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "repo-worker" } },
      policyTypes: ["Egress"],
      egress: [
        { ports: [{ port: IntOrString.fromNumber(9093), protocol: "TCP" }] },
      ],
    },
  });

  new KubeNetworkPolicy(chart, "temporal-repo-flipt-netpol", {
    metadata: { name: "temporal-repo-flipt-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "repo-worker" } },
      policyTypes: ["Egress"],
      egress: [
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "flipt" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(8080), protocol: "TCP" }],
        },
      ],
    },
  });

  new KubeNetworkPolicy(chart, "temporal-infra-api-netpol", {
    metadata: { name: "temporal-infra-api-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "infra-worker" } },
      policyTypes: ["Egress"],
      egress: [
        { ports: [{ port: IntOrString.fromNumber(6443), protocol: "TCP" }] },
        { ports: [{ port: IntOrString.fromNumber(9090), protocol: "TCP" }] },
        { ports: [{ port: IntOrString.fromNumber(7341), protocol: "TCP" }] },
      ],
    },
  });

  new KubeNetworkPolicy(chart, "temporal-worker-freshrss-netpol", {
    metadata: { name: "temporal-worker-freshrss-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "repo-worker" } },
      policyTypes: ["Egress"],
      egress: [
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "freshrss",
                },
              },
              podSelector: { matchLabels: { app: "freshrss" } },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(80), protocol: "TCP" }],
        },
      ],
    },
  });

  createTemporalScoutBetaNetworkPolicy(chart);
}
