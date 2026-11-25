import type { SeriesUnit } from "#shared/ops-schema";

type PresetDefinition = {
  title: string;
  unit: SeriesUnit;
  queries: readonly {
    promql: string;
    legendLabel?: string;
    name: string;
  }[];
};

export function single(
  title: string,
  unit: SeriesUnit,
  promql: string,
  options?: { legendLabel?: string; name?: string },
): PresetDefinition {
  return {
    title,
    unit,
    queries: [
      {
        promql,
        ...(options?.legendLabel === undefined
          ? {}
          : { legendLabel: options.legendLabel }),
        name: options?.name ?? "value",
      },
    ],
  };
}

export function multi(
  title: string,
  unit: SeriesUnit,
  queries: readonly [name: string, promql: string][],
): PresetDefinition {
  return {
    title,
    unit,
    queries: queries.map(([name, promql]) => ({ name, promql })),
  };
}

// Live catalog-priced spend; Prometheus renames the workload's `service` label
// to `exported_service` because the scrape ServiceMonitor already owns `service`.
export const LIVE_LLM_COST =
  'sum by (exported_service, workload, model) (increase(llm_cost_usd_total{type="catalog"}[{window}]))';

const SEAWEEDFS_LAG_PROMQL =
  'clamp_min((max(SeaweedFS_filer_last_send_timestamp_of_subscribe{clientName=~"filer:.*"}) - max(SeaweedFS_filer_last_send_timestamp_of_subscribe{clientName!~"filer:.*"})) / 1e9, 0)';

const ZPOOL_ARC_HIT_PROMQL =
  "max by (instance) (rate(node_zfs_arc_hits[{window}]) / clamp_min(rate(node_zfs_arc_hits[{window}]) + rate(node_zfs_arc_demand_data_misses[{window}]) + rate(node_zfs_arc_demand_metadata_misses[{window}]), 1e-9))";

export const PLATFORM_SERIES_PRESETS = {
  // Bugs / Flags / Cloud / Edge / Storage
  "bugsink-events-by-project": single(
    "Digested Bugsink events by project",
    "count",
    "max by (project) (bugsink_project_digested_events) or max by (project) (bugsink_issues_unresolved)",
    { legendLabel: "project", name: "events" },
  ),
  "flags-evaluations": single(
    "Feature flag evaluations",
    "count",
    "sum by (reason) (rate(feature_flag_evaluations_total[{window}]))",
    { legendLabel: "reason", name: "eval/s" },
  ),
  "cloudflare-r2-bytes": single(
    "Cloudflare R2 storage by bucket",
    "bytes",
    "max by (bucket) (cloudflare_r2_storage_bytes)",
    { legendLabel: "bucket", name: "storage" },
  ),
  "cloudflare-probe-latency": single(
    "Public probe HTTP latency",
    "ms",
    '1000 * max by (site) (sum by (job, instance, site) (probe_http_duration_seconds{job=~"static-site-.*"}))',
    { legendLabel: "site", name: "latency" },
  ),
  "tailscale-devices-online": single(
    "Tailscale online devices",
    "count",
    "max(tailscale_devices_online)",
    { name: "online" },
  ),
  "tailscale-node-bps": multi("Tailscale ingress throughput", "bps", [
    [
      "rx",
      'sum(rate(container_network_receive_bytes_total{namespace="tailscale"}[{window}]))',
    ],
    [
      "tx",
      'sum(rate(container_network_transmit_bytes_total{namespace="tailscale"}[{window}]))',
    ],
  ]),
  "seaweedfs-volume-slots": multi("SeaweedFS volume slots", "count", [
    ["used", "max(SeaweedFS_volumeServer_volumes)"],
    ["max", "max(SeaweedFS_volumeServer_max_volumes)"],
  ]),
  "seaweedfs-s3-rps": single(
    "SeaweedFS S3 request rate",
    "count",
    "sum by (type) (rate(SeaweedFS_s3_request_total[{window}]))",
    { legendLabel: "type", name: "req/s" },
  ),
  "seaweedfs-backup-lag": single(
    "SeaweedFS backup lag",
    "seconds",
    SEAWEEDFS_LAG_PROMQL,
    { name: "lag" },
  ),
  "zpool-usage-ratio": single(
    "ZFS pool usage",
    "ratio",
    "max by (zpool_name) (1 - zfs_zpool_free_bytes / zfs_zpool_size_bytes)",
    { legendLabel: "zpool_name", name: "used" },
  ),
  "zpool-arc-hit-ratio": single(
    "ZFS ARC hit ratio",
    "ratio",
    ZPOOL_ARC_HIT_PROMQL,
    { legendLabel: "instance", name: "arc hit" },
  ),
  "nvme-writes-24h": single(
    "NVMe physical writes (24h)",
    "bytes",
    "max by (serial) (nvme_drive:physical_written_bytes:increase24h)",
    { legendLabel: "serial", name: "written 24h" },
  ),
  "nvme-temp": single(
    "NVMe temperature",
    "celsius",
    "max by (serial) (nvme_temperature_celsius * on (device, instance) group_left (serial, model) nvme_device_info)",
    { legendLabel: "serial", name: "temp" },
  ),
  "velero-backups": single(
    "Velero backup age by schedule",
    "seconds",
    'time() - max by (schedule) (velero_backup_last_successful_timestamp{schedule!=""})',
    { legendLabel: "schedule", name: "age" },
  ),

  // Cluster / Observability / AI / Temporal
  "node-temp": single(
    "Node CPU temperature",
    "celsius",
    'max by (node) (node_hwmon_temp_celsius * on (chip, instance, sensor) group_left (label) node_hwmon_sensor_label{label=~"Tctl|Package id 0"})',
    { legendLabel: "node", name: "temp" },
  ),
  "node-psi-cpu": single(
    "Node CPU pressure (PSI)",
    "ratio",
    "max by (instance) (rate(node_pressure_cpu_waiting_seconds_total[{window}]))",
    { legendLabel: "instance", name: "psi cpu" },
  ),
  "etcd-db-bytes": single(
    "etcd MVCC database size",
    "bytes",
    "max by (instance) (etcd_mvcc_db_total_size_in_bytes)",
    { legendLabel: "instance", name: "db bytes" },
  ),
  "prometheus-tsdb-series": single(
    "Prometheus head series",
    "count",
    "max(prometheus_tsdb_head_series)",
    { name: "head series" },
  ),
  "prometheus-tsdb-bytes": single(
    "Prometheus storage bytes",
    "bytes",
    "max(prometheus_tsdb_storage_blocks_bytes + prometheus_tsdb_wal_storage_size_bytes)",
    { name: "tsdb bytes" },
  ),
  "loki-ingested-bps": single(
    "Loki ingestion throughput",
    "bps",
    "sum(rate(loki_distributor_bytes_received_total[{window}]))",
    { name: "ingested" },
  ),
  "tempo-span-rate": single(
    "Tempo ingested spans/s",
    "count",
    "sum(rate(tempo_distributor_spans_received_total[{window}]))",
    { name: "spans/s" },
  ),
  "tempo-error-rate": single(
    "Span error ratio",
    "ratio",
    'sum(rate(traces_spanmetrics_calls_total{status_code="STATUS_CODE_ERROR"}[{window}])) / clamp_min(sum(rate(traces_spanmetrics_calls_total[{window}])), 1e-9)',
    { name: "error ratio" },
  ),
  "llm-token-cache-mix": single(
    "LLM tokens by type",
    "tokens",
    "sum by (type) (increase(llm_tokens_total[{window}]))",
    { legendLabel: "type", name: "tokens" },
  ),
  "llm-p95-latency": single(
    "LLM p95 latency by model",
    "seconds",
    "histogram_quantile(0.95, sum by (le, model) (rate(llm_request_duration_seconds_bucket[{window}])))",
    { legendLabel: "model", name: "p95" },
  ),
  "temporal-schedules-by-state": multi(
    "Temporal schedules by health",
    "count",
    [
      ["running", "sum(max by (schedule_id) (temporal_schedule_running))"],
      [
        "failed",
        "sum(max by (schedule_id) (temporal_schedule_last_terminal_failed))",
      ],
      [
        "unknown",
        "sum(max by (schedule_id) (temporal_schedule_health_unknown))",
      ],
    ],
  ),
  "mail-outbox": single(
    "Mail outbox messages by status",
    "count",
    "sum by (status) (mail_outbox_messages)",
    { legendLabel: "status", name: "messages" },
  ),

  // Target-parameterized service/namespace presets
  "namespace-cpu": single(
    "Namespace CPU usage",
    "count",
    'sum by (pod) (rate(container_cpu_usage_seconds_total{namespace=~"{target}",container!="",container!="POD"}[{window}]))',
    { legendLabel: "pod", name: "cpu" },
  ),
  "namespace-memory": single(
    "Namespace working-set memory",
    "bytes",
    'sum by (pod) (container_memory_working_set_bytes{namespace=~"{target}",container!="",container!="POD"})',
    { legendLabel: "pod", name: "memory" },
  ),
  "namespace-restarts": single(
    "Container restarts",
    "count",
    'sum by (pod) (increase(kube_pod_container_status_restarts_total{namespace=~"{target}"}[{window}]))',
    { legendLabel: "pod", name: "restarts" },
  ),
  "service-span-rate": single(
    "Service span rate",
    "count",
    'sum by (status_code) (rate(traces_spanmetrics_calls_total{service=~"{target}"}[{window}]))',
    { legendLabel: "status_code", name: "spans/s" },
  ),
  "service-span-p95": single(
    "Service p95 span latency",
    "ms",
    '1000 * histogram_quantile(0.95, sum by (le) (rate(traces_spanmetrics_latency_bucket{service=~"{target}"}[{window}])))',
    { name: "p95" },
  ),
  "service-log-errors": single(
    "Namespace error log rate",
    "count",
    'sum by (namespace) (rate(loki_log_errors_total{namespace=~"{target}"}[{window}]))',
    { legendLabel: "namespace", name: "errors/s" },
  ),
} as const;
