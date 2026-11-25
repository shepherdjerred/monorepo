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
import { MAIL_API_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";
import { flagsEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  ALERTMANAGER_GATEWAY_PORT,
  PROMETHEUS_GATEWAY_PORT,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/monitoring-auth-gateways.ts";
import { PROMETHEUS_VAULT_ITEM_ID } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/prometheus-resources.ts";
import {
  nsPeer,
  tcp,
  tailscaleIngressRule,
  flagsEgress,
  homeAssistantEgressRule,
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
      const haCredentials = new OnePasswordItem(
        chart,
        "alert-dashboard-ha-1p",
        {
          spec: { itemPath: vaultItemPath(PROMETHEUS_VAULT_ITEM_ID) },
        },
      );
      const haSecret = Secret.fromSecretName(
        chart,
        "alert-dashboard-ha-secret",
        haCredentials.name,
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
            HOMEASSISTANT_URL: EnvValue.fromValue(
              "http://home-homeassistant-service.home.svc.cluster.local:8123",
            ),
            HOMEASSISTANT_TOKEN: EnvValue.fromSecretValue({
              secret: haSecret,
              key: "HOMEASSISTANT_TOKEN",
            }),
            PROMETHEUS_URL: EnvValue.fromValue(
              "http://prometheus-kube-prometheus-prometheus.prometheus:9090",
            ),
            ...flagsEnv({ deployment: "alert-dashboard/prod" }),
            MAIL_API_URL: EnvValue.fromValue(MAIL_API_ENDPOINT.url),
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
            MAIL_API_TOKEN: EnvValue.fromSecretValue({
              secret,
              key: "MAIL_API_TOKEN",
            }),
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
      // The product is Hub and `hub` is its only tailnet host.
      hosts: [
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
          flagsEgress(),
          {
            to: [MAIL_API_ENDPOINT.peer()],
            ports: [MAIL_API_ENDPOINT.tcp()],
          },
          homeAssistantEgressRule(),
          otlpEgress(),
        ],
      },
    ],
  });
}
