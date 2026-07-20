import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import { BUILDKITE_DAILY_WRITE_BUDGET_BYTES } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/buildkite.ts";
import {
  createStatPanel,
  createTimeseriesPanel,
} from "./buildkite-dashboard-panels.ts";
import {
  BUILDKITE_LOGICAL_WRITE_RATE,
  BUILDKITE_PHYSICAL_WRITE_RATE,
} from "./buildkite-io-queries.ts";

export function addBuildkiteIoImpactPanels(
  builder: dashboard.DashboardBuilder,
): void {
  builder.withRow(new dashboard.RowBuilder("CI I/O Impact Summary"));

  builder.withPanel(
    createStatPanel({
      title: "Logical Writes (24h)",
      query: `sum(max_over_time(buildkite:pod_parent_fs_writes_bytes_total[24h]))`,
      legend: "pod-parent writes",
      gridPos: { x: 0, y: 36, w: 4, h: 4 },
      unit: "bytes",
      thresholds: [
        { value: 0, color: "green" },
        { value: BUILDKITE_DAILY_WRITE_BUDGET_BYTES, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Logical Write Rate",
      query: BUILDKITE_LOGICAL_WRITE_RATE,
      legend: "CI logical",
      gridPos: { x: 4, y: 36, w: 4, h: 4 },
      unit: "Bps",
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Node Physical Write Rate",
      query: BUILDKITE_PHYSICAL_WRITE_RATE,
      legend: "diagnostic",
      gridPos: { x: 8, y: 36, w: 4, h: 4 },
      unit: "Bps",
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Physical / Logical Amplification",
      query: `${BUILDKITE_PHYSICAL_WRITE_RATE} / clamp_min(${BUILDKITE_LOGICAL_WRITE_RATE}, 1)`,
      legend: "diagnostic ratio",
      gridPos: { x: 12, y: 36, w: 4, h: 4 },
      unit: "short",
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Running Jobs Measured",
      query: `(
  (
    count(
      max by (namespace, pod) (buildkite:pod_parent_sample_present)
      and on (namespace, pod)
        (kube_pod_status_phase{namespace="buildkite", phase="Running"} == 1)
    )
    or on() vector(0)
  )
  /
  count(
    (kube_pod_status_phase{namespace="buildkite", phase="Running"} == 1)
    and on (namespace, pod)
      kube_pod_labels{namespace="buildkite", label_buildkite_com_job_uuid!=""}
  )
)`,
      legend: "coverage",
      gridPos: { x: 16, y: 36, w: 4, h: 4 },
      unit: "percentunit",
      thresholds: [
        { value: 0, color: "red" },
        { value: 0.9, color: "green" },
      ],
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Canceled Pods (24h)",
      query: `sum(increase(buildkite_pod_watcher_pods_forcefully_deleted_total{namespace="buildkite", delete_reason="job_cancelled"}[24h]))`,
      legend: "force deleted",
      gridPos: { x: 20, y: 36, w: 4, h: 4 },
      thresholds: [
        { value: 0, color: "green" },
        { value: 1, color: "yellow" },
        { value: 10, color: "red" },
      ],
    }),
  );

  builder.withRow(new dashboard.RowBuilder("Logical & Physical Throughput"));

  builder.withPanel(
    createTimeseriesPanel({
      title: "CI Logical vs Node Physical Writes",
      targets: [
        {
          query: BUILDKITE_LOGICAL_WRITE_RATE,
          legend: "CI pod-parent logical",
        },
        {
          query: BUILDKITE_PHYSICAL_WRITE_RATE,
          legend: "node physical (diagnostic)",
        },
      ],
      gridPos: { x: 0, y: 41, w: 12, h: 8 },
      unit: "Bps",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "CI Read & Write Throughput",
      targets: [
        {
          query: BUILDKITE_LOGICAL_WRITE_RATE,
          legend: "writes",
        },
        {
          query: "sum(rate(buildkite:pod_parent_fs_reads_bytes_total[5m]))",
          legend: "reads",
        },
      ],
      gridPos: { x: 12, y: 41, w: 12, h: 8 },
      unit: "Bps",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "CI Read & Write Operations",
      targets: [
        {
          query: "sum(rate(buildkite:pod_parent_fs_writes_total[5m]))",
          legend: "write IOPS",
        },
        {
          query: "sum(rate(buildkite:pod_parent_fs_reads_total[5m]))",
          legend: "read IOPS",
        },
      ],
      gridPos: { x: 0, y: 49, w: 24, h: 6 },
      unit: "iops",
    }),
  );

  builder.withRow(new dashboard.RowBuilder("Step & Container Attribution"));

  builder.withPanel(
    createTimeseriesPanel({
      title: "Top Step Write Rates",
      targets: [
        {
          query: `topk(10, sum by (label_ci_sjer_red_step_key, label_buildkite_com_job_uuid) (rate(buildkite:pod_parent_fs_writes_bytes_total[5m])))`,
          legend:
            "{{label_ci_sjer_red_step_key}} · {{label_buildkite_com_job_uuid}}",
        },
      ],
      gridPos: { x: 0, y: 56, w: 14, h: 8 },
      unit: "Bps",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Container I/O Attribution",
      targets: [
        {
          query:
            "sum by (container) (rate(buildkite:container_fs_writes_bytes_total[5m]))",
          legend: "{{container}} writes",
        },
        {
          query:
            "sum by (container) (rate(buildkite:container_fs_reads_bytes_total[5m]))",
          legend: "{{container}} reads",
        },
      ],
      gridPos: { x: 14, y: 56, w: 10, h: 8 },
      unit: "Bps",
    }),
  );
}
