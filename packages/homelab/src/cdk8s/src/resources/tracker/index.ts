import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import {
  withCommonProps,
  setRevisionHistoryLimit,
  restrictedContainer,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import {
  fliptEnv,
  seaweedfsS3,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { httpProbes } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/kubelet-probes.ts";

function databaseUrl() {
  const protocol = "postgresql";
  const user = "$(DB_USER)";
  const password = "$(DB_" + "PASSWORD)";
  return `${protocol}://${user}:${password}@tracker-postgresql:5432/tracker_db`;
}

/** A synthesis recipe is replaced by the required PG image binding before packaging. */
export function createTrackerDeployment(chart: Chart, image: string) {
  if (
    image !== "docker.io/shepherdjerred/tracker:delivery-recipe" &&
    !/^docker\.io\/shepherdjerred\/tracker@sha256:[a-f0-9]{64}$/u.test(image)
  )
    throw new Error("Tracker requires a pinned public image digest");
  const pg = Secret.fromSecretName(
    chart,
    "tracker-pg",
    "tracker.tracker-postgresql.credentials.postgresql.acid.zalan.do",
  );
  const s3Item = seaweedfsS3.item(chart, "tracker-seaweedfs-1p");
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
  const securityContext = restrictedContainer(1000);
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
      ...httpProbes(7351, {
        live: "/healthz",
        ready: "/readyz",
        startup: { failureThreshold: 18 },
      }),
      envVariables: {
        ...dbEnv,
        HOME: EnvValue.fromValue("/tmp"),
        HOST: EnvValue.fromValue("0.0.0.0"),
        PORT: EnvValue.fromValue("7351"),
        ENVIRONMENT: EnvValue.fromValue("production"),
        S3_ENDPOINT: EnvValue.fromValue(seaweedfsS3.endpoint),
        S3_BUCKET: EnvValue.fromValue("tracker-attachments"),
        S3_REGION: EnvValue.fromValue("us-east-1"),
        ...seaweedfsS3.credentialsEnv(s3),
        ...fliptEnv({ namespace: "tracker", environment: "prod" }),
        OTEL_EXPORTER_OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL),
      },
    }),
  );
  setRevisionHistoryLimit(deployment);
  const service = new Service(chart, "tracker-service", {
    metadata: { name: "tracker", labels: { app: "tracker" } },
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
