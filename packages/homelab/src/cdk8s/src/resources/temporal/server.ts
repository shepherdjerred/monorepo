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
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
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

  // PostgreSQL credentials from postgres-operator
  const postgresSecretName =
    "temporal.temporal-postgresql.credentials.postgresql.acid.zalan.do";

  const deployment = new Deployment(chart, "temporal-server", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: GID,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Temporal auto-setup requires writable filesystem for schema migrations",
      },
    },
    podMetadata: {
      labels: {
        app: "temporal-server",
      },
    },
  });

  // Mount postgres-operator secret as volume
  const pgSecretVolume = Volume.fromSecret(
    chart,
    "temporal-pg-secret-volume",
    Secret.fromSecretName(chart, "temporal-pg-secret", postgresSecretName),
    {
      name: "pg-secret",
    },
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

  deployment.addContainer(
    withCommonProps({
      name: "temporal-server",
      image: `temporalio/auto-setup:${versions["temporalio/auto-setup"]}`,
      ports: [
        { name: "grpc", number: 7233 },
        { name: "metrics", number: 9090 },
      ],
      envVariables: {
        // Database configuration
        DB: EnvValue.fromValue("postgres12"),
        DB_PORT: EnvValue.fromValue("5432"),
        POSTGRES_SEEDS: EnvValue.fromValue("temporal-postgresql"),
        DBNAME: EnvValue.fromValue("temporal"),
        VISIBILITY_DBNAME: EnvValue.fromValue("temporal_visibility"),

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
      command: ["/bin/sh", "-c"],
      args: [
        // Read credentials from postgres-operator secret, export as env vars, then start
        [
          "export POSTGRES_USER=$(cat /pg-secret/username)",
          "export POSTGRES_PWD=$(cat /pg-secret/password)",
          "exec /etc/temporal/entrypoint.sh autosetup",
        ].join(" && "),
      ],
      securityContext: {
        user: UID,
        group: GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: false,
      },
      volumeMounts: [
        {
          path: "/pg-secret",
          volume: pgSecretVolume,
          readOnly: true,
        },
        {
          path: "/etc/temporal/dynamic-config",
          volume: dynamicConfigVolume,
          readOnly: true,
        },
      ],
      resources: {
        cpu: {
          request: Cpu.millis(250),
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
        // Auto-setup runs schema migrations on first start — allow up to 5 minutes
        failureThreshold: 30,
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

  new TailscaleIngress(chart, "temporal-tailscale-ingress", {
    service,
    host: "temporal",
  });

  return { deployment, service };
}
