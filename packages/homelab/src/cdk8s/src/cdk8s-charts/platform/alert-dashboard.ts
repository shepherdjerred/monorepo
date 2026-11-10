import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createAlertDashboardDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/alert-dashboard/index.ts";
import {
  ALERTMANAGER_GATEWAY_PORT,
  PROMETHEUS_GATEWAY_PORT,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/monitoring-auth-gateways.ts";
import {
  nsPeer,
  tcp,
  tailscaleIngressRule,
  fliptEgress,
  otlpEgress,
  prometheusIngressRule,
  dnsEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export function createAlertDashboardChart(app: App) {
  const chart = new Chart(app, "alert-dashboard", {
    namespace: "alert-dashboard",
    disableResourceNameHashes: true,
  });
  new Namespace(chart, "alert-dashboard-namespace", {
    metadata: { name: "alert-dashboard" },
  });
  createAlertDashboardDeployment(chart);
  const appSelector = { matchLabels: { app: "alert-dashboard" } };

  new KubeNetworkPolicy(chart, "alert-dashboard-app-netpol", {
    metadata: { name: "alert-dashboard-app-netpol" },
    spec: {
      podSelector: appSelector,
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        tailscaleIngressRule([7341]),
        prometheusIngressRule([7341]),
        {
          from: [nsPeer("temporal"), nsPeer("trmnl-dashboard")],
          ports: [tcp(7341)],
        },
      ],
      egress: [
        {
          to: [
            {
              ...nsPeer("temporal"),
              podSelector: { matchLabels: { component: "promotion-worker" } },
            },
          ],
          ports: [tcp(7343)],
        },
        dnsEgressRule(),
        {
          to: [nsPeer("prometheus")],
          // Grafana, Alertmanager, and the ops series presets proxied from
          // Prometheus. NetworkPolicy matches the destination pod port, not
          // the Service's 80, 9090 or 9093: Grafana's named backend and the
          // same-pod authenticated gateways in front of the loopback servers.
          ports: [
            { port: IntOrString.fromString("grafana"), protocol: "TCP" },
            tcp(PROMETHEUS_GATEWAY_PORT),
            tcp(ALERTMANAGER_GATEWAY_PORT),
          ],
        },
        fliptEgress(),
        {
          to: [nsPeer("postal")],
          ports: [tcp(5000)],
        },
        otlpEgress(),
      ],
    },
  });
}
