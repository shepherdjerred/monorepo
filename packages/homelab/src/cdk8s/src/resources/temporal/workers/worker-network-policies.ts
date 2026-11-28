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
  flagsEgress,
  flagsManagementEgress,
  lokiOtlpEgress,
  otlpEgress,
  prometheusIngressRule,
  seaweedfsEgress,
  talosApiEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import {
  ALERTMANAGER_GATEWAY_PORT,
  PROMETHEUS_GATEWAY_PORT,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/monitoring-auth-gateways.ts";
import {
  ERRORS_ADMIN_ENDPOINT,
  FEEDS_ENDPOINT,
  GOLINK_ENDPOINT,
  MAIL_API_ENDPOINT,
  TRACKER_ENDPOINT,
  EXPERIMENTS_INTERNAL_ENDPOINT,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";
import { experimentsHubConfig } from "@shepherdjerred/homelab/cdk8s/src/resources/experiments/index.ts";

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

// Every domain worker built on createTemporalDomainWorker() with
// featureFlagsEnabled left at its default boots with
// temporalFeatureFlagEnvironment() so it can read the
// temporal-call-graph-tracing flag over the credentialless Flags evaluation
// port (7361). `repo-worker` instead connects to port 7360 (which serves both
// credentialless snapshots and authenticated inventory reconciliation) via
// `temporal-repo-flags-netpol`, and the credentialless central-workflows track
// keeps its own narrower NetworkPolicy (`temporal-central-workflows-netpol`).
const FLAGS_CONSUMER_COMPONENTS = [
  "gateway",
  "home-worker",
  "reports-worker",
  "infra-worker",
  "scout-worker",
  "glitter-corpus-worker",
  "glitter-context-worker",
  "agent-worker",
  "promotion-worker",
] as const;

function createTemporalWorkersFlagsEgressPolicy(chart: Chart): void {
  new KubeNetworkPolicy(chart, "temporal-workers-flags-egress", {
    metadata: { name: "temporal-workers-flags-egress" },
    spec: {
      podSelector: {
        matchExpressions: [
          {
            key: "component",
            operator: "In",
            values: [...FLAGS_CONSUMER_COMPONENTS],
          },
        ],
      },
      policyTypes: ["Egress"],
      egress: [flagsEgress()],
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
      egress: [seaweedfsEgress()],
    },
  });
}

export function createTemporalWorkerNetworkPolicies(chart: Chart): void {
  createTemporalWorkersFlagsEgressPolicy(chart);
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
        flagsEgress(),
        otlpEgress(),
        lokiOtlpEgress(),
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
          lokiOtlpEgress(),
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
        {
          to: [MAIL_API_ENDPOINT.peer()],
          ports: [MAIL_API_ENDPOINT.tcp()],
        },
        monitoringEgress(ALERTMANAGER_GATEWAY_PORT),
        {
          to: [nsPeer("alert-dashboard")],
          ports: [tcp(7341)],
        },
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

  new KubeNetworkPolicy(chart, "temporal-repo-flags-netpol", {
    metadata: { name: "temporal-repo-flags-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "repo-worker" } },
      policyTypes: ["Egress"],
      egress: [flagsManagementEgress()],
    },
  });

  // Kubernetes API, Prometheus, and the alert/ops dashboard for the audit
  // collectors; Alertmanager, Tracker and Loki for the ops-snapshot collector;
  // the Talos API for both, which run talosctl. PostHog, GitHub, Woodpecker,
  // and Bugsink ride the shared 443 rule.
  new KubeNetworkPolicy(chart, "temporal-infra-api-netpol", {
    metadata: { name: "temporal-infra-api-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "infra-worker" } },
      policyTypes: ["Egress"],
      egress: [
        { ports: [tcp(6443)] },
        talosApiEgressRule(),
        monitoringEgress(PROMETHEUS_GATEWAY_PORT),
        { ports: [tcp(7341)] },
        { to: [TRACKER_ENDPOINT.peer()], ports: [TRACKER_ENDPOINT.tcp()] },
        ...(experimentsHubConfig.active
          ? [
              {
                to: [EXPERIMENTS_INTERNAL_ENDPOINT.peer()],
                ports: [EXPERIMENTS_INTERNAL_ENDPOINT.tcp()],
              },
            ]
          : []),
        { to: [GOLINK_ENDPOINT.peer()], ports: [GOLINK_ENDPOINT.tcp()] },
        {
          to: [ERRORS_ADMIN_ENDPOINT.peer()],
          ports: [ERRORS_ADMIN_ENDPOINT.tcp()],
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

  new KubeNetworkPolicy(chart, "temporal-worker-feeds-netpol", {
    metadata: { name: "temporal-worker-feeds-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "repo-worker" } },
      policyTypes: ["Egress"],
      egress: [{ to: [FEEDS_ENDPOINT.peer()], ports: [FEEDS_ENDPOINT.tcp()] }],
    },
  });

  createTemporalScoutBetaNetworkPolicy(chart);
}
