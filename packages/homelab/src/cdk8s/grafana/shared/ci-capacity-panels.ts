/**
 * Kueue capacity and admission panels for CI.
 *
 * Kueue admits Woodpecker's pods through the pod integration and enforces the
 * node's CPU, memory and ephemeral-storage quotas.
 *
 * The I/O panels at the bottom of this file read the `woodpecker:` recording
 * rules and the step-key label the configuration extension stamps.
 */
import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import { CI_NODE_HOSTNAME } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import {
  CI_AGENT_CONFIGURED_SLOTS_METRIC,
  CI_NODE_CPU_HEADROOM_IDLE_RATIO,
  CI_PENDING_QUEUE_FOR,
  CI_PENDING_STEPS_THRESHOLD,
} from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/woodpecker-queue.ts";
import { createTimeseriesPanel } from "./dashboard-panels.ts";
/**
 * Physical block devices, excluding partitions and virtual devices.
 */
const PHYSICAL_DISK_PATTERN = "nvme[0-9]+n[0-9]+|sd[a-z]+|vd[a-z]+|xvd[a-z]+";

// Verified against the live Kueue 0.18 metric schema: these local-queue metric
// families expose the queue as `name`, while `local_queue` is absent.
const CI_LOCAL_QUEUE_SELECTOR =
  'exported_namespace="woodpecker-ci",name="default"';

/**
 * Woodpecker's own queue, upstream of Kueue: steps wait here for an agent slot
 * before any pod exists. `woodpecker_worker_count` counts idle agent slots, so
 * running steps plus idle slots equal the agents' total capacity.
 */
export function addCiAgentQueuePanels(
  builder: dashboard.DashboardBuilder,
): void {
  builder.withRow(new dashboard.RowBuilder("Woodpecker Agent Queue"));

  builder.withPanel(
    createTimeseriesPanel({
      title: "Woodpecker Queue Depth",
      description:
        "Steps by state in the Woodpecker server's queue. Pending steps wait for an agent slot; waiting steps wait on a dependency; idle slots are agent workflow slots with nothing to run.",
      targets: [
        {
          query: 'max(woodpecker_pending_steps{namespace="woodpecker"})',
          legend: "pending (waiting for an agent slot)",
        },
        {
          query: 'max(woodpecker_waiting_steps{namespace="woodpecker"})',
          legend: "waiting (on dependencies)",
        },
        {
          query: 'max(woodpecker_running_steps{namespace="woodpecker"})',
          legend: "running",
        },
        {
          query: 'max(woodpecker_worker_count{namespace="woodpecker"})',
          legend: "idle agent slots",
        },
      ],
      gridPos: { x: 0, y: 82, w: 8, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Pending Steps vs liskov CPU",
      description: `Many pending steps while the CI node has spare CPU is admission bookkeeping, not saturation: WoodpeckerPendingQueueWithCpuHeadroom fires when pending stays above ${String(CI_PENDING_STEPS_THRESHOLD)} with the node under ${String(Math.round((1 - CI_NODE_CPU_HEADROOM_IDLE_RATIO) * 100))}% busy for ${CI_PENDING_QUEUE_FOR}.`,
      targets: [
        {
          query: 'max(woodpecker_pending_steps{namespace="woodpecker"})',
          legend: "pending steps",
        },
        {
          query: `vector(${String(CI_PENDING_STEPS_THRESHOLD)})`,
          legend: "alert threshold (steps)",
        },
        {
          query: `100 * (1 - avg(rate(node_cpu_seconds_total{node="${CI_NODE_HOSTNAME}",mode="idle"}[5m])))`,
          legend: "CPU busy percent",
        },
      ],
      gridPos: { x: 8, y: 82, w: 8, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Agent Slots: Connected vs Expected",
      description:
        "Connected slots are idle plus running steps. Expected capacity is what the available agent Deployments are configured to run (their ci.sjer.red/max-workflows labels times available replicas), so it follows a cap change when the agent rollout lands, not when the source merges. A gap that persists means a running agent has lost its connection: WoodpeckerAgentDisconnected.",
      targets: [
        {
          query:
            'max(woodpecker_worker_count{namespace="woodpecker"}) + on () max(woodpecker_running_steps{namespace="woodpecker"})',
          legend: "connected slots (idle + running)",
        },
        {
          query: CI_AGENT_CONFIGURED_SLOTS_METRIC,
          legend: "expected capacity (configured)",
        },
      ],
      gridPos: { x: 16, y: 82, w: 8, h: 8 },
    }),
  );
}

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
          query: `kueue_local_queue_resource_usage{${CI_LOCAL_QUEUE_SELECTOR},resource="cpu"}`,
          legend: "CPU usage",
        },
        {
          query: `kueue_local_queue_resource_reservation{${CI_LOCAL_QUEUE_SELECTOR},resource="cpu"}`,
          legend: "CPU reserved",
        },
        {
          query: `kueue_local_queue_resource_usage{${CI_LOCAL_QUEUE_SELECTOR},resource="pods"}`,
          legend: "pods used",
        },
        {
          query: `kueue_local_queue_resource_reservation{${CI_LOCAL_QUEUE_SELECTOR},resource="pods"}`,
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
          query: `kueue_local_queue_resource_usage{${CI_LOCAL_QUEUE_SELECTOR},resource="memory"}`,
          legend: "memory usage",
        },
        {
          query: `kueue_local_queue_resource_reservation{${CI_LOCAL_QUEUE_SELECTOR},resource="memory"}`,
          legend: "memory reserved",
        },
        {
          query: `kueue_local_queue_resource_usage{${CI_LOCAL_QUEUE_SELECTOR},resource="ephemeral-storage"}`,
          legend: "ephemeral usage",
        },
        {
          query: `kueue_local_queue_resource_reservation{${CI_LOCAL_QUEUE_SELECTOR},resource="ephemeral-storage"}`,
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
      gridPos: { x: 0, y: 98, w: 12, h: 8 },
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
    kube_pod_status_phase{namespace="woodpecker-ci", phase="Running"} == 1
  )
  * on (namespace, pod) group_left(label_ci_sjer_red_step_key)
  max by (namespace, pod, label_ci_sjer_red_step_key) (
    kube_pod_labels{namespace="woodpecker-ci", label_ci_sjer_red_step_key!=""}
  )
)`,
          legend: "{{label_ci_sjer_red_step_key}}",
        },
      ],
      gridPos: { x: 12, y: 98, w: 12, h: 8 },
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
            'count(kube_pod_status_phase{namespace="woodpecker-ci",pod=~"wp-.*",phase="Running"} == 1)',
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

/**
 * Nodes currently running a CI step pod.
 *
 * Woodpecker stamps nothing identifying on a step pod, so the join goes through
 * the step-key label the configuration extension adds.
 */
const ACTIVE_CI_NODES =
  'max by (node) (kube_pod_info{namespace="woodpecker-ci"} * on (namespace, pod) group_left kube_pod_labels{namespace="woodpecker-ci", label_ci_sjer_red_step_key!=""})';

/**
 * CI write volume and I/O pressure.
 */
export function addCiIoPanels(builder: dashboard.DashboardBuilder): void {
  builder.withRow(new dashboard.RowBuilder("CI I/O"));

  builder.withPanel(
    createTimeseriesPanel({
      title: "Logical Write Rate",
      targets: [
        {
          query: "sum(rate(woodpecker:pod_parent_fs_writes_bytes_total[5m]))",
          legend: "pod-parent writes",
        },
      ],
      gridPos: { x: 0, y: 123, w: 12, h: 8 },
      unit: "Bps",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Node Physical Write Rate",
      targets: [
        {
          query: `sum(rate(node_disk_written_bytes_total{device=~"${PHYSICAL_DISK_PATTERN}"}[5m]) and on (node) ${ACTIVE_CI_NODES})`,
          legend: "physical writes",
        },
      ],
      gridPos: { x: 12, y: 123, w: 12, h: 8 },
      unit: "Bps",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "CI Pod I/O Pressure",
      targets: [
        {
          query:
            "sum(rate(woodpecker:pod_parent_io_waiting_seconds_total[5m]))",
          legend: "pod stall seconds/s",
        },
      ],
      gridPos: { x: 0, y: 131, w: 12, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Node I/O Pressure",
      targets: [
        {
          query: `sum(rate(node_pressure_io_waiting_seconds_total[5m]) and on (node) ${ACTIVE_CI_NODES})`,
          legend: "node stall seconds/s",
        },
      ],
      gridPos: { x: 12, y: 131, w: 12, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Disk Write Latency",
      targets: [
        {
          // clamp_min keeps a device with no completed writes in the window
          // from dividing by zero and disappearing from the chart.
          query: `sum by (node, device) (rate(node_disk_write_time_seconds_total{device=~"${PHYSICAL_DISK_PATTERN}"}[5m]) and on (node) ${ACTIVE_CI_NODES}) / clamp_min(sum by (node, device) (rate(node_disk_writes_completed_total{device=~"${PHYSICAL_DISK_PATTERN}"}[5m]) and on (node) ${ACTIVE_CI_NODES}), 1e-9)`,
          legend: "{{device}}",
        },
      ],
      gridPos: { x: 0, y: 139, w: 12, h: 8 },
      unit: "s",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Disk Queue Depth (Diagnostic)",
      targets: [
        {
          query: `rate(node_disk_io_time_weighted_seconds_total{device=~"${PHYSICAL_DISK_PATTERN}"}[5m]) and on (node) ${ACTIVE_CI_NODES}`,
          legend: "{{device}}",
        },
      ],
      gridPos: { x: 12, y: 139, w: 12, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "CI I/O Recording Series",
      targets: [
        {
          query: 'count({__name__=~"woodpecker:.*"})',
          legend: "recorded series",
        },
      ],
      gridPos: { x: 0, y: 147, w: 12, h: 8 },
      unit: "short",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Prometheus Storage Growth (24h)",
      targets: [
        {
          query:
            'max(delta(kubelet_volume_stats_used_bytes{namespace="prometheus", persistentvolumeclaim=~"prometheus-prometheus-kube-prometheus-prometheus.*"}[24h]))',
          legend: "PVC growth",
        },
      ],
      gridPos: { x: 12, y: 147, w: 12, h: 8 },
      unit: "bytes",
    }),
  );
}
