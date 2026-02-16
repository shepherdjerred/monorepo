import { Chart, Size } from "cdk8s";
import { ConfigMap, Cpu, Deployment, DeploymentStrategy, EnvValue, Service, Volume } from "cdk8s-plus-31";
import { withCommonProps } from "../../misc/common.ts";
import { ZfsNvmeVolume } from "../../misc/zfs-nvme-volume.ts";
import versions from "../../versions.ts";

export function createClickHouseDeployment(chart: Chart) {
  // ClickHouse runs as clickhouse user (uid 101, gid 101)
  const UID = 101;
  const GID = 101;

  // Persistent volume for ClickHouse data
  // 64GB should be sufficient for homelab analytics
  const dataVolume = new ZfsNvmeVolume(chart, "clickhouse-data", {
    storage: Size.gibibytes(64),
  });

  // ConfigMap to disable expensive system logging
  // By default ClickHouse profiles itself continuously, generating billions of rows
  // that fill up disk even with zero actual usage
  const configMap = new ConfigMap(chart, "clickhouse-config", {
    data: {
      "disable-logs.xml": `<?xml version="1.0"?>
<clickhouse>
  <!-- Disable trace_log - self-profiling generates billions of rows -->
  <trace_log remove="1"/>

  <!-- Disable text_log - not needed for homelab -->
  <text_log remove="1"/>

  <!-- Keep query_log with short TTL -->
  <query_log>
    <ttl>event_date + INTERVAL 1 DAY</ttl>
  </query_log>

  <!-- Minimal metric logging -->
  <metric_log>
    <ttl>event_date + INTERVAL 1 DAY</ttl>
  </metric_log>
  <asynchronous_metric_log>
    <ttl>event_date + INTERVAL 1 DAY</ttl>
  </asynchronous_metric_log>
</clickhouse>`,
    },
  });

  const deployment = new Deployment(chart, "clickhouse", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: GID,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs": "ClickHouse requires writable filesystem for runtime data",
      },
    },
  });

  deployment.addContainer(
    withCommonProps({
      name: "clickhouse",
      image: `clickhouse/clickhouse-server:${versions["clickhouse/clickhouse-server"]}`,
      ports: [
        { name: "http", number: 8123 },
        { name: "native", number: 9000 },
      ],
      envVariables: {
        // Database for Plausible events
        CLICKHOUSE_DB: EnvValue.fromValue("plausible_events_db"),
        CLICKHOUSE_USER: EnvValue.fromValue("plausible"),
        // Allow ClickHouse to manage access
        CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: EnvValue.fromValue("1"),
      },
      securityContext: {
        user: UID,
        group: GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: false,
      },
      volumeMounts: [
        {
          path: "/var/lib/clickhouse",
          volume: Volume.fromPersistentVolumeClaim(chart, "clickhouse-data-volume", dataVolume.claim),
        },
        {
          // Use conf.d instead of config.d to avoid overwriting docker_related_config.xml
          // which contains critical listen_host settings
          path: "/etc/clickhouse-server/conf.d",
          volume: Volume.fromConfigMap(chart, "clickhouse-config-volume", configMap),
        },
      ],
      resources: {
        cpu: {
          request: Cpu.millis(250),
          limit: Cpu.millis(2000),
        },
        memory: {
          request: Size.gibibytes(1),
          limit: Size.gibibytes(4),
        },
      },
    }),
  );

  const service = new Service(chart, "clickhouse-service", {
    selector: deployment,
    metadata: {
      labels: { app: "clickhouse" },
    },
    ports: [
      { port: 8123, name: "http" },
      { port: 9000, name: "native" },
    ],
  });

  return { deployment, service };
}
