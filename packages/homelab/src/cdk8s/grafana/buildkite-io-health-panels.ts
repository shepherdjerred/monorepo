import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import {
  createStatPanel,
  createTimeseriesPanel,
} from "./buildkite-dashboard-panels.ts";
import {
  BUILDKITE_ACTIVE_NODES,
  PHYSICAL_DISK_PATTERN,
} from "./buildkite-io-queries.ts";

export function addBuildkiteIoHealthPanels(
  builder: dashboard.DashboardBuilder,
): void {
  builder.withRow(
    new dashboard.RowBuilder("I/O Pressure & Control-Plane Correlation"),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "CI Pod I/O Pressure",
      targets: [
        {
          query: "sum(rate(buildkite:pod_parent_io_waiting_seconds_total[5m]))",
          legend: "some tasks waiting",
        },
        {
          query: "sum(rate(buildkite:pod_parent_io_stalled_seconds_total[5m]))",
          legend: "all tasks stalled",
        },
      ],
      gridPos: { x: 0, y: 65, w: 8, h: 8 },
      unit: "s",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Node I/O Pressure",
      targets: [
        {
          query: `sum(rate(node_pressure_io_waiting_seconds_total[5m]) and on (node) ${BUILDKITE_ACTIVE_NODES})`,
          legend: "some tasks waiting",
        },
        {
          query: `sum(rate(node_pressure_io_stalled_seconds_total[5m]) and on (node) ${BUILDKITE_ACTIVE_NODES})`,
          legend: "all tasks stalled",
        },
      ],
      gridPos: { x: 8, y: 65, w: 8, h: 8 },
      unit: "s",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Disk Write Latency",
      targets: [
        {
          query: `(
  sum by (node, device) (
    rate(node_disk_write_time_seconds_total{device=~"${PHYSICAL_DISK_PATTERN}"}[5m])
    and on (node) ${BUILDKITE_ACTIVE_NODES}
  )
)
/
clamp_min(
  sum by (node, device) (
    rate(node_disk_writes_completed_total{device=~"${PHYSICAL_DISK_PATTERN}"}[5m])
    and on (node) ${BUILDKITE_ACTIVE_NODES}
  ),
  1e-9
)`,
          legend: "{{node}} · {{device}}",
        },
      ],
      gridPos: { x: 16, y: 65, w: 8, h: 8 },
      unit: "s",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Disk Queue Depth (Diagnostic)",
      targets: [
        {
          query: `rate(node_disk_io_time_weighted_seconds_total{device=~"${PHYSICAL_DISK_PATTERN}"}[5m]) and on (node) ${BUILDKITE_ACTIVE_NODES}`,
          legend: "{{node}} · {{device}}",
        },
      ],
      gridPos: { x: 0, y: 73, w: 8, h: 7 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Kubernetes API p99 Write Latency",
      targets: [
        {
          query: `histogram_quantile(0.99, sum by (le) (rate(apiserver_request_duration_seconds_bucket{verb=~"CREATE|DELETE|PATCH|UPDATE"}[5m])))`,
          legend: "API p99",
        },
      ],
      gridPos: { x: 8, y: 73, w: 8, h: 7 },
      unit: "s",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "etcd Request p99 Latency",
      targets: [
        {
          query: `histogram_quantile(0.99, sum by (le) (rate(etcd_request_duration_seconds_bucket[5m])))`,
          legend: "etcd p99",
        },
      ],
      gridPos: { x: 16, y: 73, w: 8, h: 7 },
      unit: "s",
    }),
  );

  builder.withRow(
    new dashboard.RowBuilder("Controller Scheduling & Cancellation"),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Limiter State",
      targets: [
        {
          query: 'buildkite_limiter_tokens_available{namespace="buildkite"}',
          legend: "tokens available",
        },
        {
          query: 'buildkite_limiter_waiting_for_token{namespace="buildkite"}',
          legend: "waiting for token",
        },
        {
          query: 'buildkite_limiter_work_queue_length{namespace="buildkite"}',
          legend: "work queue",
        },
      ],
      gridPos: { x: 0, y: 81, w: 8, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Scheduling Outcomes",
      targets: [
        {
          query:
            'sum(rate(buildkite_scheduler_job_create_success_total{namespace="buildkite"}[5m]))',
          legend: "created",
        },
        {
          query:
            'sum(rate(buildkite_scheduler_job_create_errors_total{namespace="buildkite"}[5m]))',
          legend: "create errors",
        },
        {
          query:
            'sum(rate(buildkite_pod_watcher_pods_forcefully_deleted_total{namespace="buildkite", delete_reason="job_cancelled"}[5m]))',
          legend: "canceled",
        },
      ],
      gridPos: { x: 8, y: 81, w: 8, h: 8 },
      unit: "ops",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Controller Query Health",
      targets: [
        {
          query: 'max(buildkite_monitor_monitor_up{namespace="buildkite"})',
          legend: "monitor up",
        },
        {
          query:
            'sum(rate(buildkite_monitor_job_queries_total{namespace="buildkite"}[5m]))',
          legend: "queries",
        },
        {
          query:
            'sum(rate(buildkite_monitor_job_query_errors_total{namespace="buildkite"}[5m]))',
          legend: "query errors",
        },
        {
          query:
            'sum(rate(buildkite_completion_watcher_cleanup_errors_total{namespace="buildkite"}[5m]))',
          legend: "cleanup errors",
        },
      ],
      gridPos: { x: 16, y: 81, w: 8, h: 8 },
      unit: "short",
    }),
  );

  builder.withRow(new dashboard.RowBuilder("CI I/O Observability Cost"));

  builder.withPanel(
    createStatPanel({
      title: "CI I/O Recording Series",
      description:
        "Active series emitted by the Buildkite CI I/O recording rules. The post-deploy acceptance budget is fewer than 2,000 active series.",
      query: 'count({__name__=~"buildkite:.*"})',
      legend: "active series",
      gridPos: { x: 0, y: 90, w: 6, h: 5 },
      instant: true,
      thresholds: [
        { value: 0, color: "green" },
        { value: 1500, color: "yellow" },
        { value: 2000, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "CI I/O Rule Evaluation Duration",
      description:
        "Maximum duration of the Buildkite CI I/O rule groups. The post-deploy acceptance budget is below one second.",
      query:
        'max(prometheus_rule_group_last_duration_seconds{rule_group=~".*buildkite-ci-io-(recording|rollups|alerts).*"})',
      legend: "max duration",
      gridPos: { x: 6, y: 90, w: 6, h: 5 },
      unit: "s",
      instant: true,
      thresholds: [
        { value: 0, color: "green" },
        { value: 0.5, color: "yellow" },
        { value: 1, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "CI I/O Rule Evaluation Failures",
      description:
        "Buildkite CI I/O rule evaluation failures in the last hour. Any failure blocks observability acceptance.",
      query:
        'sum(increase(prometheus_rule_evaluation_failures_total{rule_group=~".*buildkite-ci-io-(recording|rollups|alerts).*"}[1h]))',
      legend: "failures",
      gridPos: { x: 12, y: 90, w: 6, h: 5 },
      instant: true,
      thresholds: [
        { value: 0, color: "green" },
        { value: 1, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Prometheus Storage Growth (24h)",
      description:
        "Twenty-four-hour change in used bytes for the Prometheus data PVC. This cluster-level diagnostic needs ordinary ingestion and compaction context; unexplained growth above 1 GiB makes CI I/O observability acceptance inconclusive.",
      query:
        'max(delta(kubelet_volume_stats_used_bytes{namespace="prometheus", persistentvolumeclaim=~"prometheus-prometheus-kube-prometheus-prometheus.*"}[24h]))',
      legend: "used-byte delta",
      gridPos: { x: 18, y: 90, w: 6, h: 5 },
      unit: "bytes",
      instant: true,
      thresholds: [
        { value: 0, color: "green" },
        { value: 536_870_912, color: "yellow" },
        { value: 1_073_741_824, color: "red" },
      ],
    }),
  );
}
