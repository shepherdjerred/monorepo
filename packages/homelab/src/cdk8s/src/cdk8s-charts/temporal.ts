import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
  type NetworkPolicyIngressRule,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createTemporalPostgreSQLDatabase } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/temporal-db.ts";
import { createTemporalDynamicConfig } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/dynamic-config.ts";
import { createTemporalServerDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/server.ts";
import { createTemporalUiDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/ui.ts";
import { createTemporalNamespaceInitJob } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/namespace-init.ts";
import { createTemporalWorkerDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/worker.ts";
import { createTemporalAgentWorkerNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/agent-worker-network-policy.ts";
import { TEMPORAL_AGENT_POD_SECURITY_ENFORCEMENT } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/agent-worker.ts";
import { createTemporalWorkerNetworkPolicies } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/worker-network-policies.ts";

function scoutCompetitionActivityIngress(): NetworkPolicyIngressRule {
  return {
    // Scout owns competition database and Discord delivery activities. Each
    // stage polls its own task queue from its stage namespace.
    from: ["scout-beta", "scout-prod"].map((namespace) => ({
      namespaceSelector: {
        matchLabels: { "kubernetes.io/metadata.name": namespace },
      },
      podSelector: { matchLabels: { app: "scout-backend" } },
    })),
    ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
  };
}

export function createTemporalChart(app: App) {
  const chart = new Chart(app, "temporal", {
    namespace: "temporal",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "temporal-namespace", {
    metadata: {
      name: "temporal",
      labels: {
        // The report-only agent worker deliberately uses a short-lived
        // NET_ADMIN init container for its uid-owned egress firewall and
        // SETUID in the poller for the provider uid transition. PSA has no
        // pod-scoped exception, so enforcement must permit those explicit
        // capabilities at the namespace boundary while audit/warn retain the
        // baseline signal for every workload.
        "pod-security.kubernetes.io/enforce":
          TEMPORAL_AGENT_POD_SECURITY_ENFORCEMENT,
        "pod-security.kubernetes.io/audit": "baseline",
        "pod-security.kubernetes.io/warn": "baseline",
      },
    },
  });

  createTemporalPostgreSQLDatabase(chart);
  const dynamicConfigMap = createTemporalDynamicConfig(chart);
  const server = createTemporalServerDeployment(chart, { dynamicConfigMap });
  createTemporalUiDeployment(chart, { serverService: server.service });
  createTemporalNamespaceInitJob(chart, { serverService: server.service });

  createTemporalWorkerDeployment(chart, {
    serverServiceName: server.service.name,
  });
  createTemporalAgentWorkerNetworkPolicy(chart);

  // NetworkPolicy for Temporal Server
  new KubeNetworkPolicy(chart, "temporal-server-netpol", {
    metadata: { name: "temporal-server-netpol" },
    spec: {
      podSelector: {
        matchLabels: { app: "temporal-server" },
      },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          // Allow gRPC from Tailscale (external clients/workers)
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "tailscale",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
        },
        {
          // Allow gRPC from Temporal UI within namespace
          from: [
            {
              podSelector: {
                matchLabels: { app: "temporal-ui" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
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
          ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
        },
        {
          // Allow gRPC from temporal worker
          from: [
            {
              podSelector: {
                matchExpressions: [
                  {
                    key: "component",
                    operator: "In",
                    values: [
                      "gateway",
                      "home-worker",
                      "reports-worker",
                      "infra-worker",
                      "repo-worker",
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
          ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
        },
        {
          // The agent poller has a dedicated pod label and egress policy. Its
          // provider subprocess runs under a uid that the pod-local firewall
          // rejects on this port, so only the SDK poller can use this ingress.
          from: [
            {
              podSelector: {
                matchLabels: { app: "temporal-agent-worker" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
        },
        {
          // The Buildkite-namespace maintenance worker runs cache/database
          // activities directly and needs Temporal gRPC without Kubernetes API
          // access.
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "buildkite" },
              },
              podSelector: {
                matchLabels: { app: "temporal-maintenance-worker" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
        },
        scoutCompetitionActivityIngress(),
        {
          // Scout embeds its Workflow and Activity Workers in the sole
          // stage backend pod so activities can use the live Discord gateway,
          // stage database, and report-lake PVC directly.
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "scout-beta" },
              },
              podSelector: { matchLabels: { app: "scout-backend" } },
            },
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "scout-prod" },
              },
              podSelector: { matchLabels: { app: "scout-backend" } },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
        },
        {
          // Allow Prometheus scraping metrics
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "prometheus",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(9090), protocol: "TCP" }],
        },
        {
          // Allow blackbox-exporter's in-cluster health probe (gRPC port,
          // separate from the metrics-scraping rule above)
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "prometheus",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
        },
      ],
      egress: [
        // DNS
        {
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
        },
        // PostgreSQL within namespace
        {
          to: [
            {
              podSelector: {
                matchLabels: { cluster_name: "temporal-postgresql" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(5432), protocol: "TCP" }],
        },
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
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "tailscale",
                },
              },
            },
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "cloudflare-tunnel",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(8080), protocol: "TCP" }],
        },
        {
          // Allow blackbox-exporter's in-cluster health probe
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(8080), protocol: "TCP" }],
        },
      ],
      egress: [
        // DNS
        {
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
        },
        // Temporal Server gRPC
        {
          to: [
            {
              podSelector: {
                matchLabels: { app: "temporal-server" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
        },
      ],
    },
  });

  // NetworkPolicy for PostgreSQL - only allow Temporal Server
  new KubeNetworkPolicy(chart, "temporal-postgresql-netpol", {
    metadata: { name: "temporal-postgresql-netpol" },
    spec: {
      podSelector: {
        matchLabels: { cluster_name: "temporal-postgresql" },
      },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              podSelector: {
                matchLabels: { app: "temporal-server" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(5432), protocol: "TCP" }],
        },
      ],
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
        // DNS
        {
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
        },
        // Temporal Server gRPC
        {
          to: [
            {
              podSelector: {
                matchLabels: { app: "temporal-server" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
        },
      ],
    },
  });

  createTemporalWorkerNetworkPolicies(chart);
}
