import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createAlertDashboardDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/alert-dashboard/index.ts";
import { createAlertDashboardPostgreSQLDatabase } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/alert-dashboard-db.ts";

const tcp = (port: number) => ({
  port: IntOrString.fromNumber(port),
  protocol: "TCP",
});

export function createAlertDashboardChart(app: App) {
  const chart = new Chart(app, "alert-dashboard", {
    namespace: "alert-dashboard",
    disableResourceNameHashes: true,
  });
  new Namespace(chart, "alert-dashboard-namespace", {
    metadata: { name: "alert-dashboard" },
  });
  createAlertDashboardPostgreSQLDatabase(chart);
  createAlertDashboardDeployment(chart);
  const appSelector = { matchLabels: { app: "alert-dashboard" } };

  new KubeNetworkPolicy(chart, "alert-dashboard-app-netpol", {
    metadata: { name: "alert-dashboard-app-netpol" },
    spec: {
      podSelector: appSelector,
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tailscale" },
              },
            },
          ],
          ports: [tcp(7341)],
        },
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [tcp(7341)],
        },
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "temporal" },
              },
            },
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "trmnl-dashboard",
                },
              },
            },
          ],
          ports: [tcp(7341)],
        },
      ],
      egress: [
        {
          to: [
            {
              namespaceSelector: {},
              podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(53), protocol: "UDP" },
            tcp(53),
          ],
        },
        {
          to: [
            {
              podSelector: {
                matchLabels: { cluster_name: "alert-dashboard-postgresql" },
              },
            },
          ],
          ports: [tcp(5432)],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [tcp(80), tcp(9093)],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "postal" },
              },
            },
          ],
          ports: [tcp(5000)],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tempo" },
              },
            },
          ],
          ports: [tcp(4318)],
        },
      ],
    },
  });
  new KubeNetworkPolicy(chart, "alert-dashboard-postgres-netpol", {
    metadata: { name: "alert-dashboard-postgres-netpol" },
    spec: {
      podSelector: {
        matchLabels: { cluster_name: "alert-dashboard-postgresql" },
      },
      policyTypes: ["Ingress"],
      ingress: [{ from: [{ podSelector: appSelector }], ports: [tcp(5432)] }],
    },
  });
}
