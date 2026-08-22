import type { Chart } from "cdk8s";
import {
  Capability,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Secret,
  SeccompProfileType,
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
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
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
  const dataVolume = new ZfsNvmeVolume(chart, "alert-dashboard-data", {
    storage: Size.gibibytes(1),
  });
  const dataMount = {
    path: "/data",
    volume: Volume.fromPersistentVolumeClaim(
      chart,
      "alert-dashboard-data-volume",
      dataVolume.claim,
    ),
  };
  const tmpVolume = Volume.fromEmptyDir(
    chart,
    "alert-dashboard-tmp-volume",
    "tmp",
  );
  const databaseMounts = [dataMount, { path: "/tmp", volume: tmpVolume }];

  deployment.addInitContainer(
    withCommonProps({
      name: "prisma-migrate",
      image: IMAGE,
      command: ["/bin/sh", "-c"],
      args: [
        "cd /app/packages/alert-dashboard && bunx --no-install prisma migrate deploy",
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
        privileged: false,
        capabilities: { drop: [Capability.ALL] },
        seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
      },
      envVariables: {
        DATABASE_URL: EnvValue.fromValue("file:/data/alert-dashboard.db"),
        HOME: EnvValue.fromValue("/tmp"),
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
        "cd /app/packages/alert-dashboard && exec bun src/server/index.ts",
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
        privileged: false,
        capabilities: { drop: [Capability.ALL] },
        seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
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
        POSTAL_HOST: EnvValue.fromValue(
          "http://postal-postal-web-service.postal.svc.cluster.local:5000",
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
  });
  return deployment;
}
