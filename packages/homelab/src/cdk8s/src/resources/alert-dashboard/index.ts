import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { tailnetService } from "homelab/src/platform-model.ts";
import type { Chart } from "cdk8s";
import { Cpu, DeploymentStrategy, EnvValue, Secret } from "cdk8s-plus-31";
import { Size } from "cdk8s";
import { IntOrString } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import { fliptEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
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

const IMAGE = firstPartyImageRecipe("alert-dashboard");

export function createAlertDashboardDeployment(chart: Chart) {
  return new FirstPartyWebService(chart, "alert-dashboard-web-service", {
    name: "alert-dashboard",
    port: 7341,
    probes: {
      live: "/healthz",
      ready: "/readyz",
      startup: { failureThreshold: 18 },
    },
    deployment: {
      metadata: { labels: { app: "alert-dashboard" } },
      strategy: DeploymentStrategy.recreate(),
      securityContext: { fsGroup: 1000 },
    },
    data: {
      id: "alert-dashboard-data",
      storage: Size.gibibytes(64),
      path: "/data",
    },
    containers: () => {
      const credentials = new OnePasswordItem(chart, "alert-dashboard-1p", {
        spec: { itemPath: vaultItemPath("alert-dashboard") },
      });
      const secret = Secret.fromSecretName(
        chart,
        "alert-dashboard-secret",
        credentials.name,
      );
      return {
        init: [
          {
            name: "prisma-migrate",
            image: IMAGE,
            command: ["/bin/sh", "-c"],
            args: [
              "cd /app/packages/alert-dashboard && bunx --no-install prisma migrate deploy",
            ],
            resources: {
              cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
              memory: {
                request: Size.mebibytes(64),
                limit: Size.mebibytes(256),
              },
            },
            securityContext: restrictedContainer(1000),
            envVariables: {
              DATABASE_URL: EnvValue.fromValue("file:/data/alert-dashboard.db"),
              HOME: EnvValue.fromValue("/tmp"),
            },
          },
        ],
        server: {
          image: IMAGE,
          command: ["/bin/sh", "-c"],
          args: [
            "cd /app/packages/alert-dashboard && exec bun src/server/index.ts",
          ],
          resources: {
            cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
            // Measured p95 working set (7d, 2026-10-31) sat at the old 512Mi
            // limit, which OOM-killed it 191 times in that week.
            memory: { request: Size.mebibytes(512), limit: Size.gibibytes(1) },
          },
          securityContext: restrictedContainer(1000),
          envVariables: {
            DATABASE_URL: EnvValue.fromValue("file:/data/alert-dashboard.db"),
            HOME: EnvValue.fromValue("/tmp"),
            HOST: EnvValue.fromValue("0.0.0.0"),
            PORT: EnvValue.fromValue("7341"),
            ALERTMANAGER_URL: EnvValue.fromValue(
              "http://prometheus-kube-prometheus-alertmanager.prometheus.svc.cluster.local:9093",
            ),
            GRAFANA_URL: EnvValue.fromValue(
              "http://prometheus-grafana.prometheus.svc.cluster.local:80",
            ),
            PROMETHEUS_URL: EnvValue.fromValue(
              "http://prometheus-kube-prometheus-prometheus.prometheus:9090",
            ),
            ...fliptEnv({
              namespace: "alert-dashboard",
              environment: "prod",
              order: ["FLIPT_NAMESPACE", "FLIPT_URL", "FLIPT_ENVIRONMENT"],
            }),
            POSTAL_HOST: EnvValue.fromValue(
              "http://postal-postal-web-service.postal.svc.cluster.local:5000",
            ),
            ALERT_DASHBOARD_WEBHOOK_TOKEN: EnvValue.fromSecretValue({
              secret,
              key: "WEBHOOK_TOKEN",
            }),
            // Bearer token the Temporal ops-snapshot workflow presents on
            // /internal/v1/ops/snapshots and /internal/v1/digests/:kind. The
            // same value lives on the Temporal item.
            OPS_INGEST_TOKEN: EnvValue.fromSecretValue({
              secret,
              key: "OPS_INGEST_TOKEN",
            }),
            GRAFANA_API_KEY: EnvValue.fromSecretValue({
              secret,
              key: "GRAFANA_API_KEY",
            }),
            POSTAL_API_KEY: EnvValue.fromSecretValue({
              secret,
              key: "POSTAL_API_KEY",
            }),
            POSTAL_HOST_HEADER: EnvValue.fromValue(
              tailnetService("postal").fqdn,
            ),
            OTEL_EXPORTER_OTLP_ENDPOINT: EnvValue.fromValue(
              OTLP_GATEWAY_BASE_URL,
            ),
            OTEL_SERVICE_NAME: EnvValue.fromValue("alert-dashboard"),
            TELEMETRY_ENABLED: EnvValue.fromValue("true"),
          },
        },
      };
    },
    tailscale: {
      probePath: "/healthz",
      hosts: [
        { id: "alert-dashboard-ingress", host: tailnetService("alerts") },
        // The same app serves the ops overview.
        { id: "alert-dashboard-ops-ingress", host: tailnetService("ops") },
        // The product is Hub; `ops` and `alerts` stay for existing links.
        { id: "alert-dashboard-hub-ingress", host: tailnetService("hub") },
      ],
    },
    policies: [
      {
        name: "alert-dashboard-app-netpol",
        selects: "app",
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
    ],
  });
}
