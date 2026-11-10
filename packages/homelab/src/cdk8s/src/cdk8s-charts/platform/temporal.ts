import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import {
  KubeNetworkPolicy,
  type NetworkPolicyIngressRule,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createTemporalNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/namespace.ts";
import {
  createTemporalPostgreSQLDatabase,
  createTemporalPostgreSQLNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/temporal-db.ts";
import { createTemporalPostgreSQLCertificate } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/temporal-db-tls.ts";
import { transitionRendering } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import { createTemporalDynamicConfig } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/dynamic-config.ts";
import { createTemporalServerDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/server.ts";
import { createTemporalUiDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/ui.ts";
import { createTemporalNamespaceInitJob } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/namespace-init.ts";
import { createTemporalSchemaMigrationJob } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/schema-migration.ts";
import { createTemporalWorkerDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/workers/worker.ts";
import { createStreambotWorker } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/workers/streambot-worker.ts";
import { createTemporalAgentWorkerNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/workers/agent-worker-network-policy.ts";
import { createTemporalWorkerNetworkPolicies } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/workers/worker-network-policies.ts";
import { SCOUT_STAGES } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/topology.ts";
import {
  createTemporalExternalAuthSecret,
  TEMPORAL_EXTERNAL_GATEWAY_PORT,
} from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/external-auth.ts";
import {
  nsPeer,
  tcp,
  postgresEgress,
  dnsEgressRule,
  tailscaleIngressRule,
  blackboxProbeIngressRule,
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

// One pod identity, two reasons, so one rule. Scout owns competition database
// and Discord delivery activities, and each stage polls its own task queue from
// its stage namespace. The same sole stage backend pod also embeds Scout's
// Workflow and Activity Workers, so those activities can use the live Discord
// gateway, stage database, and report-lake PVC directly.
function scoutBackendIngress(): NetworkPolicyIngressRule {
  return {
    from: ["scout-beta", "scout-prod"].map((namespace) => ({
      ...nsPeer(namespace),
      podSelector: { matchLabels: { app: "scout-backend" } },
    })),
    ports: [tcp(7233)],
  };
}

/**
 * The `gateway` runtime role's Temporal client.
 *
 * A separate identity because the split gave the role its own pod and its own
 * `app` label, and the rules above match `app: scout-backend` exactly. The role
 * runs no Activity worker at all — `runtime/plan.ts` still pushes `temporal-core`
 * unconditionally, because Discord commands start Workflows they do not execute,
 * so a blocked client here is every slash command failing to dispatch rather
 * than a worker going idle.
 */
export function scoutGatewayClientIngress(): NetworkPolicyIngressRule[] {
  return [
    {
      from: SCOUT_STAGES.map((stage) => ({
        ...nsPeer(`scout-${stage}`),
        podSelector: { matchLabels: { app: "scout-gateway" } },
      })),
      ports: [tcp(7233)],
    },
  ];
}

/** The split activity worker polls stage-local realtime and background queues. */
function scoutActivityWorkerIngress(): NetworkPolicyIngressRule[] {
  return [
    {
      from: SCOUT_STAGES.map((stage) => ({
        ...nsPeer(`scout-${stage}`),
        podSelector: { matchLabels: { app: "scout-activity-worker" } },
      })),
      ports: [tcp(7233)],
    },
  ];
}

function scoutWorkflowWorkerIngress(): NetworkPolicyIngressRule {
  return {
    from: ["scout-beta", "scout-prod"].map((namespace) => ({
      ...nsPeer(namespace),
      podSelector: {
        matchLabels: {
          "worker-family": `${namespace}-workflows`,
        },
      },
    })),
    ports: [tcp(7233)],
  };
}

export function createTemporalChart(app: App) {
  const chart = new Chart(app, "temporal", {
    namespace: "temporal",
    disableResourceNameHashes: true,
  });

  // Under transition rendering the operator-run `temporal-data` chart owns the
  // Namespace, the PostgreSQL TLS chain, the `temporal-postgresql` cluster and
  // its ingress NetworkPolicy; everything below only connects to that database.
  if (!transitionRendering()) {
    createTemporalNamespace(chart, { retained: false });
    createTemporalPostgreSQLCertificate(chart);
    createTemporalPostgreSQLDatabase(chart);
  }
  createTemporalSchemaMigrationJob(chart);
  const dynamicConfigMap = createTemporalDynamicConfig(chart);
  const externalAuthSecret = createTemporalExternalAuthSecret(chart);
  const server = createTemporalServerDeployment(chart, {
    dynamicConfigMap,
    externalAuthSecret,
  });
  createTemporalUiDeployment(chart, {
    serverService: server.service,
    externalAuthSecret,
  });
  createTemporalNamespaceInitJob(chart, { serverService: server.service });

  createTemporalWorkerDeployment(chart, {
    serverServiceName: server.service.name,
  });
  createTemporalAgentWorkerNetworkPolicy(chart);
  createStreambotWorker(chart, server.service.name);

  // NetworkPolicy for Temporal Server
  new KubeNetworkPolicy(chart, "temporal-server-netpol", {
    metadata: { name: "temporal-server-netpol" },
    spec: {
      podSelector: {
        matchLabels: { app: "temporal-server" },
      },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        // Tailscale reaches only the bearer-authenticated gRPC gateway.
        tailscaleIngressRule([TEMPORAL_EXTERNAL_GATEWAY_PORT]),
        {
          // Allow gRPC from Temporal UI within namespace
          from: [
            {
              podSelector: {
                matchLabels: { app: "temporal-ui" },
              },
            },
          ],
          ports: [tcp(7233)],
        },
        {
          // Allow gRPC from namespace init job
          from: [
            {
              podSelector: {
                matchLabels: { app: "temporal-namespace-init" },
              },
            },
          ],
          ports: [tcp(7233)],
        },
        {
          // Fixed worker roles in the Temporal namespace, including all three
          // independently released Delivery control-plane pollers.
          from: [
            {
              ...nsPeer("temporal"),
              podSelector: {
                matchExpressions: [
                  {
                    key: "component",
                    operator: "In",
                    values: [
                      "gateway",
                      "delivery-worker",
                      "delivery-platform-worker",
                      "delivery-workflows",
                      "home-worker",
                      "reports-worker",
                      "infra-worker",
                      "repo-worker",
                      "streambot-worker",
                      "scout-worker",
                      "glitter-corpus-worker",
                      "glitter-context-worker",
                      "central-workflows",
                    ],
                  },
                ],
              },
            },
          ],
          ports: [tcp(7233)],
        },
        {
          // Native replay, routing, and self-upgrade Jobs are isolated from
          // poller Pods and from arbitrary clients in either Job namespace.
          from: ["delivery-worker-jobs", "delivery-platform-jobs"].map(
            (namespace) => ({
              ...nsPeer(namespace),
              podSelector: { matchLabels: { app: "delivery-stage" } },
            }),
          ),
          ports: [tcp(7233)],
        },
        {
          // Stable and candidate Workflow-only workers share a family label
          // while their component labels identify the active track.
          from: [
            {
              podSelector: {
                matchLabels: { "worker-family": "central-workflows" },
              },
            },
          ],
          ports: [tcp(7233)],
        },
        {
          // Agent pollers have dedicated pod labels and egress policies. Each
          // provider subprocess runs under a uid that the pod-local firewall
          // rejects on this port, so only the SDK poller can use this ingress.
          from: ["temporal-agent-worker", "temporal-promotion-worker"].map(
            (workerApp) => ({
              podSelector: {
                matchLabels: { app: workerApp },
              },
            }),
          ),
          ports: [tcp(7233)],
        },
        {
          // The CI-namespace maintenance worker runs cache/database activities
          // directly and needs Temporal gRPC without Kubernetes API access.
          from: [
            {
              ...nsPeer("woodpecker-ci"),
              podSelector: {
                matchLabels: { app: "temporal-maintenance-worker" },
              },
            },
          ],
          ports: [tcp(7233)],
        },
        ...["storm-forum", "storm-forum-beta"].map((namespace) => ({
          from: [
            {
              ...nsPeer(namespace),
              podSelector: {
                matchLabels: { app: "storm-forum", component: "web" },
              },
            },
          ],
          ports: [tcp(7233)],
        })),
        scoutBackendIngress(),
        {
          from: [
            {
              ...nsPeer("media"),
              podSelector: {
                matchLabels: { "media.sjer.red/application": "true" },
              },
            },
          ],
          ports: [tcp(7233)],
        },
        scoutWorkflowWorkerIngress(),
        ...scoutGatewayClientIngress(),
        ...scoutActivityWorkerIngress(),
        // Allow Prometheus scraping metrics
        prometheusIngressRule([9090]),
        // Allow blackbox-exporter's in-cluster health probe (gRPC port,
        // separate from the metrics-scraping rule above). The probe follows
        // the Tailscale-facing Service and therefore reaches the
        // authenticated gateway's target port.
        blackboxProbeIngressRule(TEMPORAL_EXTERNAL_GATEWAY_PORT),
      ],
      egress: [
        dnsEgressRule(),
        // PostgreSQL within namespace
        postgresEgress("temporal-postgresql"),
      ],
    },
  });

  // NetworkPolicy for Temporal UI
  new KubeNetworkPolicy(chart, "temporal-ui-netpol", {
    metadata: { name: "temporal-ui-netpol" },
    spec: {
      podSelector: {
        matchLabels: { app: "temporal-ui" },
      },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          // Allow from Tailscale and Cloudflare Tunnel
          from: [nsPeer("tailscale"), nsPeer("cloudflare-tunnel")],
          ports: [tcp(8080)],
        },
        // Allow blackbox-exporter's in-cluster health probe
        blackboxProbeIngressRule(8080),
      ],
      egress: [
        dnsEgressRule(),
        // Temporal Server gRPC
        {
          to: [
            {
              podSelector: {
                matchLabels: { app: "temporal-server" },
              },
            },
          ],
          ports: [tcp(7233)],
        },
      ],
    },
  });

  if (!transitionRendering()) createTemporalPostgreSQLNetworkPolicy(chart);

  new KubeNetworkPolicy(chart, "temporal-schema-migration-netpol", {
    metadata: {
      name: "temporal-schema-migration-netpol",
      // The egress policy for the migration pod, so it must exist before that
      // pod runs at wave -1 rather than with the rest of the netpols at 0.
      annotations: { "argocd.argoproj.io/sync-wave": "-2" },
    },
    spec: {
      podSelector: {
        matchLabels: { app: "temporal-schema-migration" },
      },
      policyTypes: ["Egress"],
      egress: [dnsEgressRule(), postgresEgress("temporal-postgresql")],
    },
  });

  // NetworkPolicy for namespace init job
  new KubeNetworkPolicy(chart, "temporal-namespace-init-netpol", {
    metadata: { name: "temporal-namespace-init-netpol" },
    spec: {
      podSelector: {
        matchLabels: { app: "temporal-namespace-init" },
      },
      policyTypes: ["Egress"],
      egress: [
        dnsEgressRule(),
        // Temporal Server gRPC
        {
          to: [
            {
              podSelector: {
                matchLabels: { app: "temporal-server" },
              },
            },
          ],
          ports: [tcp(7233)],
        },
      ],
    },
  });

  createTemporalWorkerNetworkPolicies(chart);
}
