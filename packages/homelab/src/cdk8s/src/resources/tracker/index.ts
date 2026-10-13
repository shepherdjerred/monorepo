import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
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
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";

function databaseUrl() {
  const protocol = "postgresql";
  const user = "$(DB_USER)";
  const password = "$(DB_" + "PASSWORD)";
  return `${protocol}://${user}:${password}@tracker-postgresql:5432/tracker_db`;
}

/** The caller supplies a published catalog digest; no placeholder image enters a release. */
export function createTrackerDeployment(chart: Chart, image: string) {
  if (!/^ghcr\.io\/shepherdjerred\/tracker@sha256:[a-f0-9]{64}$/u.test(image))
    throw new Error("Tracker requires a pinned public image digest");
  const pg = Secret.fromSecretName(
    chart,
    "tracker-pg",
    "tracker.tracker-postgresql.credentials.postgresql.acid.zalan.do",
  );
  const s3Item = new OnePasswordItem(chart, "tracker-seaweedfs-1p", {
    spec: { itemPath: vaultItemPath("vet52jaeh75chsalu6lulugium") },
  });
  const s3 = Secret.fromSecretName(chart, "tracker-s3", s3Item.name);
  const dbEnv = {
    DB_USER: EnvValue.fromSecretValue({ secret: pg, key: "username" }),
    DB_PASSWORD: EnvValue.fromSecretValue({ secret: pg, key: "password" }),
    DATABASE_URL: EnvValue.fromValue(databaseUrl()),
  };
  const deployment = new Deployment(chart, "tracker", {
    metadata: { labels: { app: "tracker" } },
    podMetadata: { labels: { app: "tracker" } },
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: { fsGroup: 1000 },
  });
  const securityContext = {
    user: 1000,
    group: 1000,
    ensureNonRoot: true,
    readOnlyRootFilesystem: true,
    allowPrivilegeEscalation: false,
    privileged: false,
    capabilities: { drop: [Capability.ALL] },
    seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
  };
  const tmp = Volume.fromEmptyDir(chart, "tracker-tmp", "tmp");
  const volumeMounts = [{ path: "/tmp", volume: tmp }];
  deployment.addInitContainer(
    withCommonProps({
      name: "prisma-migrate",
      image,
      command: ["bunx", "--no-install", "prisma", "migrate", "deploy"],
      securityContext,
      volumeMounts,
      resources: {
        cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
        memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
      },
      envVariables: { ...dbEnv, HOME: EnvValue.fromValue("/tmp") },
    }),
  );
  deployment.addContainer(
    withCommonProps({
      name: "tracker",
      image,
      command: ["bun", "src/server/index.ts"],
      ports: [{ name: "http", number: 7351 }],
      securityContext,
      volumeMounts,
      resources: {
        cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
        memory: { request: Size.mebibytes(128), limit: Size.mebibytes(512) },
      },
      startup: Probe.fromHttpGet("/healthz", {
        port: 7351,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 18,
      }),
      liveness: Probe.fromHttpGet("/healthz", {
        port: 7351,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/readyz", {
        port: 7351,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
      envVariables: {
        ...dbEnv,
        HOME: EnvValue.fromValue("/tmp"),
        HOST: EnvValue.fromValue("0.0.0.0"),
        PORT: EnvValue.fromValue("7351"),
        ENVIRONMENT: EnvValue.fromValue("production"),
        S3_ENDPOINT: EnvValue.fromValue(
          "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
        ),
        S3_BUCKET: EnvValue.fromValue("tracker-attachments"),
        S3_REGION: EnvValue.fromValue("us-east-1"),
        AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
          secret: s3,
          key: "SEAWEEDFS_ACCESS_KEY_ID",
        }),
        AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
          secret: s3,
          key: "SEAWEEDFS_SECRET_ACCESS_KEY",
        }),
        FEATURE_FLAGS_MODE: EnvValue.fromValue("flipt"),
        FLIPT_NAMESPACE: EnvValue.fromValue("tracker"),
        FLIPT_ENVIRONMENT: EnvValue.fromValue("prod"),
        FLIPT_URL: EnvValue.fromValue(
          "http://flipt-flipt-service.flipt.svc.cluster.local:8080",
        ),
        OTEL_EXPORTER_OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL),
      },
    }),
  );
  setRevisionHistoryLimit(deployment);
  const service = new Service(chart, "tracker-service", {
    metadata: { labels: { app: "tracker" } },
    selector: deployment,
    ports: [{ name: "http", port: 7351 }],
  });
  createServiceMonitor(chart, {
    name: "tracker",
    namespace: "tracker",
    port: "http",
    matchLabels: { app: "tracker" },
  });
  new TailscaleIngress(chart, "tracker-ingress", {
    service,
    host: "tracker",
    probePath: "/readyz",
  });
  return deployment;
}
