/**
 * Kueue capacity and admission panels for CI.
 *
 * Kept when the Buildkite dashboard was removed: Kueue still admits CI work
 * and still enforces the node's CPU, memory and ephemeral-storage quotas, so
 * losing these charts would have been a real observability regression from
 * what is only a CI provider swap. The agent-health and per-job I/O panels
 * DID go, because they keyed off Buildkite-specific metrics and pod labels.
 */
import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import { createTimeseriesPanel } from "./dashboard-panels.ts";
/**
 * Physical block devices, excluding partitions and virtual devices.
 *
 * Inlined when the Buildkite dashboard was removed -- it lived in that
 * directory's I/O query module, but it describes the node's disks rather than
 * anything CI-provider specific.
 */
const PHYSICAL_DISK_PATTERN = "nvme[0-9]+n[0-9]+|sd[a-z]+|vd[a-z]+|xvd[a-z]+";

// Verified against the live Kueue 0.18 metric schema: these local-queue metric
// families expose the queue as `name`, while `local_queue` is absent.
const BUILDKITE_LOCAL_QUEUE_SELECTOR =
  'exported_namespace="woodpecker",name="default"';

export function addCiCapacityHealthPanels(
  builder: dashboard.DashboardBuilder,
): void {
  builder.withRow(new dashboard.RowBuilder("Kueue Admission & CI Mix"));

  builder.withPanel(
    createTimeseriesPanel({
      title: "Kueue Pending & Admitted Workloads",
      targets: [
        {
          query:
            'kueue_pending_workloads{cluster_queue="woodpecker",status="active"} or on() vector(0)',
          legend: "pending active",
        },
        {
          query:
            'kueue_pending_workloads{cluster_queue="woodpecker",status="inadmissible"} or on() vector(0)',
          legend: "pending inadmissible",
        },
        {
          query:
            'kueue_admitted_active_workloads{cluster_queue="woodpecker"} or on() vector(0)',
          legend: "admitted",
        },
      ],
      gridPos: { x: 0, y: 90, w: 8, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Kueue CPU & Pod Reservations",
      targets: [
        {
          query: `kueue_local_queue_resource_usage{${BUILDKITE_LOCAL_QUEUE_SELECTOR},resource="cpu"}`,
          legend: "CPU usage",
        },
        {
          query: `kueue_local_queue_resource_reservation{${BUILDKITE_LOCAL_QUEUE_SELECTOR},resource="cpu"}`,
          legend: "CPU reserved",
        },
        {
          query: `kueue_local_queue_resource_usage{${BUILDKITE_LOCAL_QUEUE_SELECTOR},resource="pods"}`,
          legend: "pods used",
        },
        {
          query: `kueue_local_queue_resource_reservation{${BUILDKITE_LOCAL_QUEUE_SELECTOR},resource="pods"}`,
          legend: "pods reserved",
        },
      ],
      gridPos: { x: 8, y: 90, w: 8, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Kueue Memory & Ephemeral Reservations",
      targets: [
        {
          query: `kueue_local_queue_resource_usage{${BUILDKITE_LOCAL_QUEUE_SELECTOR},resource="memory"}`,
          legend: "memory usage",
        },
        {
          query: `kueue_local_queue_resource_reservation{${BUILDKITE_LOCAL_QUEUE_SELECTOR},resource="memory"}`,
          legend: "memory reserved",
        },
        {
          query: `kueue_local_queue_resource_usage{${BUILDKITE_LOCAL_QUEUE_SELECTOR},resource="ephemeral-storage"}`,
          legend: "ephemeral usage",
        },
        {
          query: `kueue_local_queue_resource_reservation{${BUILDKITE_LOCAL_QUEUE_SELECTOR},resource="ephemeral-storage"}`,
          legend: "ephemeral reserved",
        },
      ],
      gridPos: { x: 16, y: 90, w: 8, h: 8 },
      unit: "bytes",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Kueue Admission Delay",
      targets: [0.5, 0.95, 0.99].map((quantile) => ({
        query: `histogram_quantile(${String(quantile)}, sum by (le) (rate(kueue_admission_wait_time_seconds_bucket{cluster_queue="woodpecker"}[30m])))`,
        legend: `p${String(quantile * 100)}`,
      })),
      gridPos: { x: 0, y: 98, w: 8, h: 8 },
      unit: "s",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Woodpecker Limiter Queue Delay",
      targets: [0.5, 0.95, 0.99].map((quantile) => ({
        query: `histogram_quantile(${String(quantile)}, sum by (le) (rate(woodpecker_limiter_work_wait_duration_seconds_bucket{namespace="woodpecker"}[30m])))`,
        legend: `p${String(quantile * 100)}`,
      })),
      gridPos: { x: 8, y: 98, w: 8, h: 8 },
      unit: "s",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Running CI Mix by Step",
      targets: [
        {
          query: `sum by (label_ci_sjer_red_step_key) (
  max by (namespace, pod) (
    kube_pod_status_phase{namespace="woodpecker", phase="Running"} == 1
  )
  * on (namespace, pod) group_left(label_ci_sjer_red_step_key)
  max by (namespace, pod, label_ci_sjer_red_step_key) (
    kube_pod_labels{namespace="woodpecker", label_ci_sjer_red_step_key!=""}
  )
)`,
          legend: "{{label_ci_sjer_red_step_key}}",
        },
      ],
      gridPos: { x: 16, y: 98, w: 8, h: 8 },
    }),
  );

  builder.withRow(new dashboard.RowBuilder("Node Thermal & I/O Correlation"));

  const amdTctl = `node_hwmon_temp_celsius{node="liskov"}
* on (chip, instance, sensor) group_left(label)
node_hwmon_sensor_label{node="liskov", label="Tctl"}`;

  builder.withPanel(
    createTimeseriesPanel({
      title: "AMD Tctl Current & Rolling Quantiles",
      targets: [
        { query: amdTctl, legend: "current" },
        {
          query: `quantile_over_time(0.95, (${amdTctl})[1h:1m])`,
          legend: "p95 (1h)",
        },
        {
          query: `quantile_over_time(0.99, (${amdTctl})[1h:1m])`,
          legend: "p99 (1h)",
        },
        {
          query: `max_over_time((${amdTctl})[1h:1m])`,
          legend: "max (1h)",
        },
      ],
      gridPos: { x: 0, y: 107, w: 8, h: 8 },
      unit: "celsius",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "AMD Tctl Time Above Threshold (24h)",
      targets: [90, 94, 95].map((temperature) => ({
        query: `sum_over_time(((${amdTctl}) > bool ${String(temperature)})[24h:1m]) * 60`,
        legend: `>${String(temperature)}C`,
      })),
      gridPos: { x: 8, y: 107, w: 8, h: 8 },
      unit: "s",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "CI Concurrency & Node CPU Saturation",
      targets: [
        {
          query:
            'count(kube_pod_status_phase{namespace="woodpecker",phase="Running"} == 1)',
          legend: "running CI pods",
        },
        {
          query:
            '100 * (1 - avg(rate(node_cpu_seconds_total{node="liskov",mode="idle"}[5m])))',
          legend: "CPU busy percent",
        },
      ],
      gridPos: { x: 16, y: 107, w: 8, h: 8 },
      unit: "short",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Disk I/O Utilization p95/p99",
      targets: [0.95, 0.99].map((quantile) => ({
        query: `quantile_over_time(${String(quantile)}, (rate(node_disk_io_time_seconds_total{node="liskov",device=~"${PHYSICAL_DISK_PATTERN}"}[5m]))[1h:1m])`,
        legend: `{{device}} p${String(quantile * 100)}`,
      })),
      gridPos: { x: 0, y: 115, w: 12, h: 8 },
      unit: "percentunit",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Turbo Cache Cleanup",
      targets: [
        {
          query:
            'time() - kubernetes_maintenance_last_success_timestamp_seconds{maintenance_job="turbo-cache-clean"}',
          legend: "seconds since success",
        },
        {
          query:
            'sum(increase(turbo_cache_cleanup_entries_total{result="deleted"}[24h]))',
          legend: "entries deleted (24h)",
        },
        {
          query:
            'sum(increase(turbo_cache_cleanup_entries_total{result="scanned"}[24h]))',
          legend: "entries scanned (24h)",
        },
      ],
      gridPos: { x: 12, y: 115, w: 12, h: 8 },
    }),
  );
}
