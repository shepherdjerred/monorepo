import { App, Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { IntOrString, KubeNetworkPolicy } from "../../generated/imports/k8s.ts";
import { createPlausiblePostgreSQLDatabase } from "../resources/postgres/plausible-db.ts";
import { createClickHouseDeployment } from "../resources/analytics/clickhouse.ts";
import { createPlausibleDeployment } from "../resources/analytics/plausible.ts";

export function createPlausibleChart(app: App) {
  const chart = new Chart(app, "plausible", {
    namespace: "plausible",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "plausible-namespace", {
    metadata: {
      name: "plausible",
    },
  });

  createPlausiblePostgreSQLDatabase(chart);
  const clickhouse = createClickHouseDeployment(chart);
  createPlausibleDeployment(chart, { clickhouseService: clickhouse.service });

  // NetworkPolicy for plausible app
  new KubeNetworkPolicy(chart, "plausible-netpol", {
    metadata: { name: "plausible-netpol" },
    spec: {
      podSelector: { matchLabels: { "cdk8s.io/metadata.addr": "plausible-plausible-c80d69e0" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          // Allow from Tailscale and Cloudflare Tunnel
          from: [
            { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "tailscale" } } },
            { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "cloudflare-tunnel" } } },
          ],
          ports: [{ port: IntOrString.fromNumber(8000), protocol: "TCP" }],
        },
      ],
      egress: [
        // Allow DNS
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
        // Allow PostgreSQL within namespace
        {
          to: [{ podSelector: { matchLabels: { cluster_name: "plausible-postgresql" } } }],
          ports: [{ port: IntOrString.fromNumber(5432), protocol: "TCP" }],
        },
        // Allow ClickHouse within namespace
        {
          to: [{ podSelector: { matchLabels: { "cdk8s.io/metadata.addr": "plausible-clickhouse-c8e23ab7" } } }],
          ports: [{ port: IntOrString.fromNumber(8123), protocol: "TCP" }],
        },
        // Allow Postal SMTP
        {
          to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "postal" } } }],
          ports: [{ port: IntOrString.fromNumber(25), protocol: "TCP" }],
        },
      ],
    },
  });

  // NetworkPolicy for ClickHouse - only allow plausible app
  new KubeNetworkPolicy(chart, "clickhouse-netpol", {
    metadata: { name: "clickhouse-netpol" },
    spec: {
      podSelector: { matchLabels: { "cdk8s.io/metadata.addr": "plausible-clickhouse-c8e23ab7" } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [{ podSelector: { matchLabels: { "cdk8s.io/metadata.addr": "plausible-plausible-c80d69e0" } } }],
          ports: [{ port: IntOrString.fromNumber(8123), protocol: "TCP" }],
        },
      ],
    },
  });

  // NetworkPolicy for PostgreSQL - only allow plausible app
  new KubeNetworkPolicy(chart, "postgresql-netpol", {
    metadata: { name: "postgresql-netpol" },
    spec: {
      podSelector: { matchLabels: { cluster_name: "plausible-postgresql" } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [{ podSelector: { matchLabels: { "cdk8s.io/metadata.addr": "plausible-plausible-c80d69e0" } } }],
          ports: [{ port: IntOrString.fromNumber(5432), protocol: "TCP" }],
        },
      ],
    },
  });
}
