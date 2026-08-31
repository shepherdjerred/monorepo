import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import type { ConfigMap } from "cdk8s-plus-31";
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
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import {
  TEMPORAL_POSTGRES_TLS_CA_FILE,
  TEMPORAL_POSTGRES_TLS_SECRET,
  TEMPORAL_POSTGRES_TLS_SERVER_NAME,
} from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/temporal-db-tls.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export type CreateTemporalServerDeploymentProps = {
  dynamicConfigMap: ConfigMap;
};

export function createTemporalServerDeployment(
  chart: Chart,
  props: CreateTemporalServerDeploymentProps,
) {
  const UID = 1000;
  const GID = 1000;

  // PostgreSQL credentials from postgres-operator.
  const postgresSecretName =
    "temporal.temporal-postgresql.credentials.postgresql.acid.zalan.do";
  const postgresSecret = Secret.fromSecretName(
    chart,
    "temporal-server-postgres-secret",
    postgresSecretName,
  );

  const deployment = new Deployment(chart, "temporal-server", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: GID,
    },
    podMetadata: {
      labels: {
        app: "temporal-server",
      },
    },
  });

  const postgresTlsVolume = Volume.fromSecret(
    chart,
    "temporal-server-postgres-tls-volume",
    Secret.fromSecretName(
      chart,
      "temporal-server-postgres-tls-secret",
      TEMPORAL_POSTGRES_TLS_SECRET,
    ),
    { name: "postgres-tls" },
  );
  const configVolume = Volume.fromEmptyDir(
    chart,
    "temporal-server-config-volume",
    "config",
  );
  const tmpVolume = Volume.fromEmptyDir(
    chart,
    "temporal-server-tmp-volume",
    "tmp",
  );

  // Mount dynamic config as volume
  const dynamicConfigVolume = Volume.fromConfigMap(
    chart,
    "temporal-dynamic-config-volume",
    props.dynamicConfigMap,
    {
      name: "dynamic-config",
    },
  );

  // The image's own entrypoint renders /etc/temporal/config/docker.yaml from
  // /etc/temporal/config/config_template.yaml (baked into the image) via
  // `dockerize`. Mounting configVolume straight onto /etc/temporal/config in
  // the main container would completely shadow that directory — including
  // the template the entrypoint depends on — leaving nothing for dockerize
  // to render and crash-looping every pod before port 7233 ever opens. Copy
  // the template into the (still-empty) shared volume first, from the same
  // image, so the main container's mount already contains it.
  const configTemplateImage = `temporalio/server:${versions["temporalio/server"]}`;
  deployment.addInitContainer(
    withCommonProps({
      name: "temporal-server-config-template",
      image: configTemplateImage,
      command: ["/bin/sh", "-c"],
      args: [
        "cp /etc/temporal/config/config_template.yaml /new-config/config_template.yaml",
      ],
      securityContext: {
        user: UID,
        group: GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
      },
      volumeMounts: [{ path: "/new-config", volume: configVolume }],
      resources: {
        cpu: { request: Cpu.millis(10), limit: Cpu.millis(100) },
        memory: { request: Size.mebibytes(16), limit: Size.mebibytes(64) },
      },
    }),
  );

  deployment.addContainer(
    withCommonProps({
      name: "temporal-server",
      image: configTemplateImage,
      ports: [
        { name: "grpc", number: 7233 },
        { name: "metrics", number: 9090 },
      ],
      envVariables: {
        // Database configuration
        DB: EnvValue.fromValue("postgres12"),
        DB_PORT: EnvValue.fromValue("5432"),
        POSTGRES_SEEDS: EnvValue.fromValue(TEMPORAL_POSTGRES_TLS_SERVER_NAME),
        POSTGRES_USER: EnvValue.fromSecretValue({
          secret: postgresSecret,
          key: "username",
        }),
        POSTGRES_PWD: EnvValue.fromSecretValue({
          secret: postgresSecret,
          key: "password",
        }),
        DBNAME: EnvValue.fromValue("temporal"),
        VISIBILITY_DBNAME: EnvValue.fromValue("temporal_visibility"),
        POSTGRES_TLS_ENABLED: EnvValue.fromValue("true"),
        // Trust the stable CA (see temporal-db-tls.ts), not the rotating
        // leaf's own tls.crt: the leaf's key rotates on every cert-manager
        // renewal, but this long-running server only re-reads its trust
        // file on pod restart. Trusting tls.crt would work until the first
        // rotation, then silently break every new connection.
        POSTGRES_TLS_CA_FILE: EnvValue.fromValue(
          `/etc/temporal/postgres-tls/${TEMPORAL_POSTGRES_TLS_CA_FILE}`,
        ),
        POSTGRES_TLS_SERVER_NAME: EnvValue.fromValue(
          TEMPORAL_POSTGRES_TLS_SERVER_NAME,
        ),
        SQL_TLS_ENABLED: EnvValue.fromValue("true"),
        SQL_CA: EnvValue.fromValue(
          `/etc/temporal/postgres-tls/${TEMPORAL_POSTGRES_TLS_CA_FILE}`,
        ),
        SQL_HOST_VERIFICATION: EnvValue.fromValue("true"),
        SQL_HOST_NAME: EnvValue.fromValue(TEMPORAL_POSTGRES_TLS_SERVER_NAME),

        // All-in-one mode: run all 4 services in one process
        SERVICES: EnvValue.fromValue("frontend,history,matching,worker"),

        // History shards - IMMUTABLE after first deployment
        NUM_HISTORY_SHARDS: EnvValue.fromValue("512"),

        // Logging - JSON format for Loki ingestion
        LOG_LEVEL: EnvValue.fromValue("info"),

        // Dynamic config file path
        DYNAMIC_CONFIG_FILE_PATH: EnvValue.fromValue(
          "/etc/temporal/dynamic-config/dynamic-config.yaml",
        ),

        // Prometheus metrics endpoint
        PROMETHEUS_ENDPOINT: EnvValue.fromValue("0.0.0.0:9090"),
      },
      securityContext: {
        user: UID,
        group: GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
      },
      volumeMounts: [
        {
          path: "/etc/temporal/postgres-tls",
          volume: postgresTlsVolume,
          readOnly: true,
        },
        {
          path: "/etc/temporal/dynamic-config",
          volume: dynamicConfigVolume,
          readOnly: true,
        },
        { path: "/etc/temporal/config", volume: configVolume },
        { path: "/tmp", volume: tmpVolume },
      ],
      resources: {
        cpu: {
          request: Cpu.millis(100),
          limit: Cpu.millis(1000),
        },
        memory: {
          request: Size.mebibytes(512),
          limit: Size.gibibytes(2),
        },
      },
      liveness: Probe.fromTcpSocket({
        port: 7233,
        initialDelaySeconds: Duration.seconds(30),
        periodSeconds: Duration.seconds(30),
      }),
      readiness: Probe.fromTcpSocket({
        port: 7233,
        initialDelaySeconds: Duration.seconds(15),
        periodSeconds: Duration.seconds(10),
      }),
      startup: Probe.fromTcpSocket({
        port: 7233,
        failureThreshold: 18,
        periodSeconds: Duration.seconds(10),
      }),
    }),
  );

  setRevisionHistoryLimit(deployment);

  // Separate services: one for gRPC (used by clients/workers/UI/ingress)
  // and one for metrics (used by Prometheus scraping)
  const service = new Service(chart, "temporal-server-service", {
    selector: deployment,
    metadata: {
      labels: { app: "temporal-server" },
    },
    ports: [{ port: 7233, name: "grpc" }],
  });

  new Service(chart, "temporal-server-metrics-service", {
    selector: deployment,
    metadata: {
      labels: { app: "temporal-server-metrics" },
    },
    ports: [{ port: 9090, name: "metrics" }],
  });

  createServiceMonitor(chart, {
    name: "temporal-server-metrics",
    matchLabels: { app: "temporal-server-metrics" },
  });

  new TailscaleIngress(chart, "temporal-tailscale-ingress", {
    service,
    host: "temporal",
    // Temporal's frontend speaks gRPC, not HTTP — an HTTP probe would
    // misreport it as down even when healthy.
    probeModule: "tcp_connect",
  });

  return { deployment, service };
}
