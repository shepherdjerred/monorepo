import type { Chart } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { Duration, Size } from "cdk8s";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import {
  buildDbUrlScript,
  vaultItemPath,
} from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const IMAGE = `ghcr.io/shepherdjerred/alert-dashboard:${versions["shepherdjerred/alert-dashboard"]}`;

export function createAlertDashboardDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "alert-dashboard", {
    metadata: { labels: { app: "alert-dashboard" } },
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: { fsGroup: 1000 },
  });
  const credentials = new OnePasswordItem(chart, "alert-dashboard-1p", {
    spec: { itemPath: vaultItemPath("alert-dashboard") },
  });
  const secret = Secret.fromSecretName(
    chart,
    "alert-dashboard-secret",
    credentials.name,
  );
  const postgresSecret = Secret.fromSecretName(
    chart,
    "alert-dashboard-postgres-secret",
    "alert_dashboard.alert-dashboard-postgresql.credentials.postgresql.acid.zalan.do",
  );
  const pgSecretVolume = Volume.fromSecret(
    chart,
    "alert-dashboard-pg-secret-volume",
    postgresSecret,
    { name: "pg-secret" },
  );
  const dbUrlVolume = Volume.fromEmptyDir(
    chart,
    "alert-dashboard-db-url-volume",
    "db-url",
  );
  const tmpVolume = Volume.fromEmptyDir(
    chart,
    "alert-dashboard-tmp-volume",
    "tmp",
  );
  const databaseMounts = [
    { path: "/db-url", volume: dbUrlVolume },
    { path: "/tmp", volume: tmpVolume },
  ];

  deployment.addInitContainer(
    withCommonProps({
      name: "build-db-url",
      image: `library/busybox:${versions["library/busybox"]}`,
      command: ["/bin/sh", "-c"],
      args: [
        buildDbUrlScript(
          "alert-dashboard-postgresql:5432",
          "alert_dashboard",
          "/db-url/url",
          "ssl=true",
        ),
      ],
      resources: {
        cpu: { request: Cpu.millis(5), limit: Cpu.millis(50) },
        memory: { request: Size.mebibytes(8), limit: Size.mebibytes(32) },
      },
      securityContext: {
        user: 1000,
        group: 1000,
        ensureNonRoot: true,
        readOnlyRootFilesystem: false,
      },
      volumeMounts: [
        { path: "/pg-secret", volume: pgSecretVolume, readOnly: true },
        { path: "/db-url", volume: dbUrlVolume },
      ],
    }),
  );
  deployment.addInitContainer(
    withCommonProps({
      name: "prisma-migrate",
      image: IMAGE,
      command: ["/bin/sh", "-c"],
      args: [
        "export DATABASE_URL=$(cat /db-url/url) && cd /app/packages/alert-dashboard && bunx prisma migrate deploy",
      ],
      resources: {
        cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
        memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
      },
      securityContext: {
        user: 1000,
        group: 1000,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
      },
      volumeMounts: databaseMounts,
    }),
  );
  deployment.addContainer(
    withCommonProps({
      name: "alert-dashboard",
      image: IMAGE,
      command: ["/bin/sh", "-c"],
      args: [
        "export DATABASE_URL=$(cat /db-url/url) && exec bun packages/alert-dashboard/src/server/index.ts",
      ],
      ports: [{ name: "http", number: 7341 }],
      resources: {
        cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
        memory: { request: Size.mebibytes(128), limit: Size.mebibytes(512) },
      },
      securityContext: {
        user: 1000,
        group: 1000,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
      },
      startup: Probe.fromHttpGet("/healthz", {
        port: 7341,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 18,
      }),
      liveness: Probe.fromHttpGet("/healthz", {
        port: 7341,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/readyz", {
        port: 7341,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
      volumeMounts: databaseMounts,
      envVariables: {
        HOST: EnvValue.fromValue("0.0.0.0"),
        PORT: EnvValue.fromValue("7341"),
        ALERTMANAGER_URL: EnvValue.fromValue(
          "http://prometheus-kube-prometheus-alertmanager.prometheus.svc.cluster.local:9093",
        ),
        GRAFANA_URL: EnvValue.fromValue(
          "http://prometheus-grafana.prometheus.svc.cluster.local:80",
        ),
        POSTAL_HOST: EnvValue.fromValue(
          "http://postal-web-service.postal.svc.cluster.local:5000",
        ),
        EMAIL_ENABLED: EnvValue.fromSecretValue({
          secret,
          key: "EMAIL_ENABLED",
        }),
        ALERT_DASHBOARD_WEBHOOK_TOKEN: EnvValue.fromSecretValue({
          secret,
          key: "WEBHOOK_TOKEN",
        }),
        GRAFANA_API_KEY: EnvValue.fromSecretValue({
          secret,
          key: "GRAFANA_API_KEY",
        }),
        POSTAL_API_KEY: EnvValue.fromSecretValue({
          secret,
          key: "POSTAL_API_KEY",
        }),
        POSTAL_FROM: EnvValue.fromSecretValue({ secret, key: "POSTAL_FROM" }),
        POSTAL_HOST_HEADER: EnvValue.fromSecretValue({
          secret,
          key: "POSTAL_HOST_HEADER",
        }),
        POSTAL_TO: EnvValue.fromSecretValue({ secret, key: "POSTAL_TO" }),
        OTEL_EXPORTER_OTLP_ENDPOINT: EnvValue.fromValue(
          "http://tempo.tempo.svc.cluster.local:4318",
        ),
        OTEL_SERVICE_NAME: EnvValue.fromValue("alert-dashboard"),
        TELEMETRY_ENABLED: EnvValue.fromValue("true"),
      },
    }),
  );
  setRevisionHistoryLimit(deployment);
  const service = new Service(chart, "alert-dashboard-service", {
    metadata: { labels: { app: "alert-dashboard" } },
    selector: deployment,
    ports: [{ name: "http", port: 7341 }],
  });
  createServiceMonitor(chart, {
    name: "alert-dashboard",
    port: "http",
    namespace: "alert-dashboard",
    matchLabels: { app: "alert-dashboard" },
  });
  new TailscaleIngress(chart, "alert-dashboard-ingress", {
    service,
    host: "alerts",
    probePath: "/healthz",
    // The chart is synthesized before its Argo CD Application is activated.
    // Register the probe in the activation change so the live probe fleet does
    // not alert on a Service that intentionally does not exist yet.
    disableProbe: true,
  });
  return deployment;
}
