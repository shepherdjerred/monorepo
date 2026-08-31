import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import type { ConfigMap } from "cdk8s-plus-31";
import {
  Cpu,
  Deployment,
  EnvValue,
  DeploymentStrategy,
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
import { TEMPORAL_POSTGRES_TLS_SECRET } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/temporal-db-tls.ts";
import {
  TEMPORAL_SERVER_CONFIG_DIRECTORY,
  TEMPORAL_SERVER_CONFIG_PATH,
  TEMPORAL_SERVER_DYNAMIC_CONFIG_DIRECTORY,
  TEMPORAL_SERVER_POSTGRES_TLS_DIRECTORY,
  addConfigRenderInitContainer,
} from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/server-config.ts";
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
  const serverImage = `temporalio/server:${versions["temporalio/server"]}`;

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

  addConfigRenderInitContainer(chart, deployment, {
    serverImage,
    postgresSecret,
    configVolume,
    uid: UID,
    gid: GID,
  });

  deployment.addContainer(
    withCommonProps({
      name: "temporal-server",
      image: serverImage,
      ports: [
        { name: "grpc", number: 7233 },
        { name: "metrics", number: 9090 },
      ],
      envVariables: {
        // `temporal-server start` does NOT look for config files by default.
        // Absent an explicit path it logs "Loading configuration from
        // environment variables only", renders its own embedded template, and
        // dies on Cassandra defaults -- with the rendered config sitting
        // unread beside it. Note `render-config` DOES default to discovering
        // files, so validating with that subcommand hides this entirely.
        //
        // Everything else that used to be here (DB_*, POSTGRES_*, SQL_*,
        // SERVICES, NUM_HISTORY_SHARDS, PROMETHEUS_ENDPOINT) was a dockerize
        // template input consumed by the auto-setup image and configured
        // nothing once the template was gone. The password is deliberately
        // absent too: only the init container needs it.
        TEMPORAL_SERVER_CONFIG_FILE_PATH: EnvValue.fromValue(
          TEMPORAL_SERVER_CONFIG_PATH,
        ),
      },
      securityContext: {
        user: UID,
        group: GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
      },
      volumeMounts: [
        {
          path: TEMPORAL_SERVER_POSTGRES_TLS_DIRECTORY,
          volume: postgresTlsVolume,
          readOnly: true,
        },
        {
          path: TEMPORAL_SERVER_DYNAMIC_CONFIG_DIRECTORY,
          volume: dynamicConfigVolume,
          readOnly: true,
        },
        { path: TEMPORAL_SERVER_CONFIG_DIRECTORY, volume: configVolume },
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
