import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import { createTimeseriesPanel } from "./buildkite-dashboard-panels.ts";
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
  1
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
      unit: "ops",
    }),
  );
}
