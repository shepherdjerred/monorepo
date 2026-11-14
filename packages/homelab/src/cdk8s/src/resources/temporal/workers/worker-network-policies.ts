import type { Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createTemporalScoutBetaNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/scout-beta-network.ts";
import {
  dnsEgressRule,
  nsPeer,
  tcp,
  cloudflareTunnelIngressRule,
  blackboxProbeIngressRule,
  fliptEgress,
  otlpEgress,
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import {
  ALERTMANAGER_GATEWAY_PORT,
  PROMETHEUS_GATEWAY_PORT,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/monitoring-auth-gateways.ts";

/**
 * The gateway's public webhook listeners (GitHub, agent tasks, Xcode Cloud,
 * sleep), each behind its own Service and TunnelBinding in `http-services.ts`.
 */
const GATEWAY_WEBHOOK_PORTS = [9466, 9467, 9468, 9469] as const;

/**
 * Prometheus and Alertmanager listen on loopback behind a same-pod
 * authenticated gateway, and their Services map 9090 and 9093 onto the
 * gateway's pod ports. NetworkPolicy matches the destination pod port, so a
 * rule naming a Service port admits nothing once a controller enforces it.
 */
export function monitoringEgress(
  port: typeof PROMETHEUS_GATEWAY_PORT | typeof ALERTMANAGER_GATEWAY_PORT,
) {
  return {
    to: [nsPeer("prometheus")],
    ports: [tcp(port)],
  };
}

export function metricsIngress(ports: readonly number[]) {
  return [prometheusIngressRule(ports)];
}

function temporalServerEgress() {
  return {
    to: [{ podSelector: { matchLabels: { app: "temporal-server" } } }],
    ports: [tcp(7233)],
  };
}

function fliptPodEgress() {
  return {
    to: [
      { ...nsPeer("flipt"), podSelector: { matchLabels: { app: "flipt" } } },
    ],
    ports: [tcp(8080)],
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
  "promotion-worker",
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
      egress: [fliptPodEgress()],
    },
  });
}

function createTemporalWorkersSeaweedfsEgressPolicy(chart: Chart): void {
  new KubeNetworkPolicy(chart, "temporal-workers-seaweedfs-netpol", {
    metadata: { name: "temporal-workers-seaweedfs-netpol" },
    spec: {
      podSelector: {
        matchExpressions: [
          {
            key: "component",
            operator: "In",
            values: [
              "reports-worker",
              "repo-worker",
              "scout-worker",
              "glitter-corpus-worker",
              // Reads the corpus the corpus worker writes
              // (`GLITTER_CORPUS_S3_ENDPOINT`).
              "glitter-context-worker",
              // The Red Warfare recording archive on the mining-reset queue.
              "infra-worker",
            ],
          },
        ],
      },
      policyTypes: ["Egress"],
      egress: [
        {
          to: [
            {
              ...nsPeer("seaweedfs"),
              podSelector: {
                matchLabels: {
                  "app.kubernetes.io/name": "seaweedfs",
                  "app.kubernetes.io/instance": "seaweedfs",
                  "app.kubernetes.io/component": "s3",
                },
              },
            },
          ],
          ports: [tcp(8333)],
        },
      ],
    },
  });
}

export function createTemporalWorkerNetworkPolicies(chart: Chart): void {
  createTemporalWorkersFliptEgressPolicy(chart);
  createTemporalWorkersSeaweedfsEgressPolicy(chart);

  new KubeNetworkPolicy(chart, "temporal-central-workflows-netpol", {
    metadata: { name: "temporal-central-workflows-netpol" },
    spec: {
      podSelector: { matchLabels: { "worker-family": "central-workflows" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: metricsIngress([9464, 9465]),
      egress: [
        dnsEgressRule(),
        temporalServerEgress(),
        fliptPodEgress(),
        otlpEgress(),
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
    "billing-worker",
  ]) {
    new KubeNetworkPolicy(chart, `${component}-network-policy`, {
      metadata: { name: `temporal-${component}-netpol` },
      spec: {
        podSelector: { matchLabels: { component } },
        policyTypes: ["Ingress", "Egress"],
        ingress: metricsIngress([9464, 9465]),
        egress: [
          dnsEgressRule(),
          temporalServerEgress(),
          { ports: [tcp(443)] },
          { ports: [tcp(4318)] },
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
        cloudflareTunnelIngressRule(GATEWAY_WEBHOOK_PORTS),
        // Each webhook Service is a registered probe target, so
        // blackbox-exporter connects to the same ports in-cluster.
        ...GATEWAY_WEBHOOK_PORTS.map((port) => blackboxProbeIngressRule(port)),
      ],
      egress: [monitoringEgress(ALERTMANAGER_GATEWAY_PORT)],
    },
  });

  new KubeNetworkPolicy(chart, "temporal-reports-internal-netpol", {
    metadata: { name: "temporal-reports-internal-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "reports-worker" } },
      policyTypes: ["Egress"],
      egress: [
        { ports: [tcp(5000)] },
        monitoringEgress(ALERTMANAGER_GATEWAY_PORT),
      ],
    },
  });

  new KubeNetworkPolicy(chart, "temporal-repo-alertmanager-netpol", {
    metadata: { name: "temporal-repo-alertmanager-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "repo-worker" } },
      policyTypes: ["Egress"],
      egress: [monitoringEgress(ALERTMANAGER_GATEWAY_PORT)],
    },
  });

  new KubeNetworkPolicy(chart, "temporal-repo-flipt-netpol", {
    metadata: { name: "temporal-repo-flipt-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "repo-worker" } },
      policyTypes: ["Egress"],
      egress: [fliptEgress()],
    },
  });

  // Kubernetes API, Prometheus, and the alert/ops dashboard for the audit
  // collectors; Alertmanager, Tracker and Loki for the ops-snapshot collector.
  // PostHog, GitHub, Woodpecker, and Bugsink ride the shared 443 rule.
  new KubeNetworkPolicy(chart, "temporal-infra-api-netpol", {
    metadata: { name: "temporal-infra-api-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "infra-worker" } },
      policyTypes: ["Egress"],
      egress: [
        { ports: [tcp(6443)] },
        monitoringEgress(PROMETHEUS_GATEWAY_PORT),
        { ports: [tcp(7341)] },
        {
          to: [
            {
              ...nsPeer("tracker"),
              podSelector: { matchLabels: { app: "tracker" } },
            },
          ],
          ports: [tcp(7351)],
        },
        {
          to: [
            {
              ...nsPeer("prometheus"),
              podSelector: {
                matchLabels: {
                  "app.kubernetes.io/name": "grafana",
                  "app.kubernetes.io/instance": "prometheus",
                },
              },
            },
          ],
          // The HTTP service targets Grafana's named backend port (3000).
          ports: [{ port: IntOrString.fromString("grafana"), protocol: "TCP" }],
        },
        monitoringEgress(ALERTMANAGER_GATEWAY_PORT),
        {
          to: [nsPeer("loki")],
          ports: [tcp(3100)],
        },
        {
          to: [nsPeer("tempo")],
          ports: [tcp(3200)],
        },
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
              ...nsPeer("freshrss"),
              podSelector: { matchLabels: { app: "freshrss" } },
            },
          ],
          ports: [tcp(80)],
        },
      ],
    },
  });

  createTemporalScoutBetaNetworkPolicy(chart);
}
