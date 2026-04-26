import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createTemporalPostgreSQLDatabase } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/temporal-db.ts";
import { createTemporalDynamicConfig } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/dynamic-config.ts";
import { createTemporalServerDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/server.ts";
import { createTemporalUiDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/ui.ts";
import { createTemporalNamespaceInitJob } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/namespace-init.ts";
import { createTemporalWorkerDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/worker.ts";

export function createTemporalChart(app: App) {
  const chart = new Chart(app, "temporal", {
    namespace: "temporal",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "temporal-namespace", {
    metadata: {
      name: "temporal",
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
                matchLabels: { app: "temporal-worker" },
              },
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

  // NetworkPolicy for Temporal Worker
  // Worker needs broad egress: Temporal server, HA, GitHub, OpenAI, Postal, S3, golink
  new KubeNetworkPolicy(chart, "temporal-worker-netpol", {
    metadata: { name: "temporal-worker-netpol" },
    spec: {
      podSelector: {
        matchLabels: { app: "temporal-worker" },
      },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          // Allow Prometheus scraping worker SDK metrics
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "prometheus",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(9464), protocol: "TCP" }],
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
        // External HTTPS (HA, GitHub, OpenAI, Postal, S3, golink, Firestore)
        {
          ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }],
        },
        // Postal internal (HTTP within cluster)
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "postal",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(5000), protocol: "TCP" }],
        },
        // K8s API (for golink-sync ingress listing)
        {
          ports: [{ port: IntOrString.fromNumber(6443), protocol: "TCP" }],
        },
      ],
    },
  });
}
