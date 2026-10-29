import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import {
  createStatPanel,
  createTimeseriesPanel,
} from "@shepherdjerred/homelab/cdk8s/grafana/shared/dashboard-panels.ts";
import {
  CI_STEP_WORKSPACE_LOGICAL_BYTES_24H,
  CI_STEP_WORKSPACES_24H,
  CI_WORKSPACE_PHYSICAL_BYTES_PER_PVC_24H,
  NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY,
  NVME_DRIVE_WRITTEN_BYTES_24H,
  NVME_DRIVE_WRITTEN_BYTES_PER_DAY_7D,
  ZFS_POOL_LOGICAL_WRITTEN_BYTES_24H,
  ZFS_POOL_PHYSICAL_WRITTEN_BYTES_24H,
  ZFS_POOL_WRITE_AMPLIFICATION_24H,
} from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/storage/nvme.ts";

const SERIAL_FILTER = 'serial=~"$serial"';
const NVME_INFO = `nvme_device_info{${SERIAL_FILTER}}`;

function withNvmeIdentity(metric: string): string {
  return `(${metric}) * on(device, instance) group_left(serial, model) ${NVME_INFO}`;
}

// Range queries over days must follow the physical drive across reboots that
// swap device names, so aggregate the identity-joined series by serial first.
function bySerial(metric: string): string {
  return `max by (instance, serial, model) (${withNvmeIdentity(metric)})`;
}

const DATA_UNIT_BYTES = 512_000;

export function addNvmePanels(builder: dashboard.DashboardBuilder): void {
  builder.withRow(new dashboard.RowBuilder("NVMe Lifetime & Write Health"));

  builder.withPanel(
    createTimeseriesPanel({
      title: "NVMe Lifetime and Recent Writes",
      targets: [
        {
          query: withNvmeIdentity(
            `nvme_data_units_written_total * ${String(DATA_UNIT_BYTES)}`,
          ),
          legend: "{{model}} · {{serial}} lifetime",
        },
        {
          query: withNvmeIdentity(
            `increase(nvme_data_units_written_total[24h]) * ${String(DATA_UNIT_BYTES)}`,
          ),
          legend: "{{model}} · {{serial}} 24h",
        },
        {
          query: withNvmeIdentity(
            `increase(nvme_data_units_written_total[7d]) * ${String(DATA_UNIT_BYTES)}`,
          ),
          legend: "{{model}} · {{serial}} 7d",
        },
      ],
      gridPos: { x: 0, y: 70, w: 12, h: 8 },
      unit: "bytes",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "NVMe Wear & Available Spare",
      targets: [
        {
          query: withNvmeIdentity("nvme_percentage_used_ratio"),
          legend: "{{model}} · {{serial}} wear",
        },
        {
          query: withNvmeIdentity("nvme_available_spare_ratio"),
          legend: "{{model}} · {{serial}} spare",
        },
        {
          query: withNvmeIdentity("nvme_available_spare_threshold_ratio"),
          legend: "{{model}} · {{serial}} spare threshold",
        },
      ],
      gridPos: { x: 12, y: 70, w: 12, h: 8 },
      unit: "percentunit",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "NVMe Temperature",
      targets: [
        {
          query: withNvmeIdentity("nvme_temperature_celsius"),
          legend: "{{model}} · {{serial}}",
        },
      ],
      gridPos: { x: 0, y: 78, w: 8, h: 8 },
      unit: "celsius",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "NVMe Host Write Commands",
      targets: [
        {
          query: withNvmeIdentity(
            "increase(nvme_host_write_commands_total[24h])",
          ),
          legend: "{{model}} · {{serial}} 24h",
        },
        {
          query: withNvmeIdentity(
            "increase(nvme_host_write_commands_total[7d])",
          ),
          legend: "{{model}} · {{serial}} 7d",
        },
      ],
      gridPos: { x: 8, y: 78, w: 8, h: 8 },
      unit: "short",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "NVMe Error and Shutdown Counters",
      targets: [
        {
          query: withNvmeIdentity("nvme_media_errors_total"),
          legend: "{{model}} · {{serial}} media errors",
        },
        {
          query: withNvmeIdentity("nvme_num_err_log_entries_total"),
          legend: "{{model}} · {{serial}} error-log entries",
        },
        {
          query: withNvmeIdentity("nvme_unsafe_shutdowns_total"),
          legend: "{{model}} · {{serial}} unsafe shutdowns",
        },
      ],
      gridPos: { x: 16, y: 78, w: 8, h: 8 },
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "NVMe Critical Warnings",
      description: "The NVMe SMART critical-warning bitmap; zero is healthy.",
      query: withNvmeIdentity("nvme_critical_warning"),
      legend: "{{model}} · {{serial}}",
      gridPos: { x: 0, y: 86, w: 8, h: 4 },
      instant: true,
      thresholds: [
        { value: 0, color: "green" },
        { value: 1, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "NVMe 5-Year Write Budget Used (24h)",
      description:
        "Physical writes in the last 24h as a share of the daily budget that lasts each drive's remaining life 5 more years. The budget uses the faster of observed wear per byte and rated endurance (600 TBW per TB). Above 100% fires NvmeWriteBudgetExceeded.",
      query: `${NVME_DRIVE_WRITTEN_BYTES_24H}{${SERIAL_FILTER}} / on(node, instance, serial, model) ${NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY}`,
      legend: "{{node}} · {{serial}}",
      gridPos: { x: 8, y: 86, w: 8, h: 4 },
      unit: "percentunit",
      instant: true,
      thresholds: [
        { value: 0, color: "green" },
        { value: 0.8, color: "orange" },
        { value: 1, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "NVMe Projected Days to Rated Wear-Out",
      description:
        "Days until SMART percentage_used reaches 100% at the last 14 days' wear rate. Empty or infinite means no recent wear.",
      query: `(1 - ${bySerial("nvme_percentage_used_ratio")}) / (delta(${bySerial("nvme_percentage_used_ratio")}[14d:1h]) / 14)`,
      legend: "{{model}} · {{serial}}",
      gridPos: { x: 16, y: 86, w: 8, h: 4 },
      unit: "d",
      instant: true,
      thresholds: [
        { value: 0, color: "red" },
        { value: 180, color: "orange" },
        { value: 365, color: "green" },
      ],
    }),
  );

  addWriteBudgetPanels(builder);
}

// Per-dataset logical writes over 24h, labelled with the owning claim when the
// dataset backs a bound PV (dataset `<pool>/<pv name>`). The PV's claimRef is
// unique per volume; PVC info is not, since a restore claim can name the same
// volume. Datasets without a bound PV keep only their dataset name.
const datasetWrites24h =
  'label_replace(sum by (node, dataset) (increase(node_zfs_zpool_dataset_nwritten[24h])), "persistentvolume", "$1", "dataset", "[^/]+/(.+)")';
const datasetWritesWithClaim = `${datasetWrites24h} * on(persistentvolume) group_left(claim_namespace, name) max by (persistentvolume, claim_namespace, name) (kube_persistentvolume_claim_ref)`;

function addWriteBudgetPanels(builder: dashboard.DashboardBuilder): void {
  builder.withRow(
    new dashboard.RowBuilder("NVMe Write Budget & ZFS Amplification"),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "NVMe Physical Writes vs 5-Year Budget",
      targets: [
        {
          query: `${NVME_DRIVE_WRITTEN_BYTES_24H}{${SERIAL_FILTER}}`,
          legend: "{{node}} · {{serial}} last 24h",
        },
        {
          query: `${NVME_DRIVE_WRITTEN_BYTES_PER_DAY_7D}{${SERIAL_FILTER}}`,
          legend: "{{node}} · {{serial}} 7d avg/day",
        },
        {
          query: `${NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY}{${SERIAL_FILTER}}`,
          legend: "{{node}} · {{serial}} budget/day",
        },
      ],
      gridPos: { x: 0, y: 91, w: 12, h: 8 },
      unit: "decbytes",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "ZFS Pool Write Amplification (24h)",
      targets: [
        {
          query: ZFS_POOL_WRITE_AMPLIFICATION_24H,
          legend: "{{node}} · {{zpool}} physical ÷ logical",
        },
      ],
      gridPos: { x: 12, y: 91, w: 12, h: 8 },
      unit: "none",
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Top Datasets by Logical Writes (24h)",
      description:
        "The ten datasets applications wrote most into over the last 24h, named by their claim when they back a PVC. Physical writes are these times the pool's amplification.",
      query: `topk(10, ${datasetWritesWithClaim} or (${datasetWrites24h} unless on(persistentvolume) kube_persistentvolume_claim_ref))`,
      legend: "{{node}} · {{claim_namespace}}/{{name}} {{dataset}}",
      gridPos: { x: 0, y: 99, w: 12, h: 8 },
      unit: "decbytes",
      instant: true,
      thresholds: [{ value: 0, color: "blue" }],
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "ZFS Pool Logical and Physical Writes (24h)",
      targets: [
        {
          query: ZFS_POOL_LOGICAL_WRITTEN_BYTES_24H,
          legend: "{{node}} · {{zpool}} logical",
        },
        {
          query: ZFS_POOL_PHYSICAL_WRITTEN_BYTES_24H,
          legend: "{{node}} · {{zpool}} physical",
        },
        {
          query: CI_WORKSPACE_PHYSICAL_BYTES_PER_PVC_24H,
          legend: "{{node}} · physical per CI workspace",
        },
      ],
      gridPos: { x: 12, y: 99, w: 12, h: 8 },
      unit: "decbytes",
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "CI Workspace Writes by Step (24h)",
      description:
        "Logical bytes each CI step's fresh workspaces wrote over the last 24h.",
      query: `sort_desc(${CI_STEP_WORKSPACE_LOGICAL_BYTES_24H})`,
      legend: "{{step}}",
      gridPos: { x: 0, y: 107, w: 12, h: 8 },
      unit: "decbytes",
      instant: true,
      thresholds: [{ value: 0, color: "blue" }],
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "CI Logical Writes per Workspace by Step (24h)",
      description:
        "Average logical bytes one workspace of each step wrote: what a cheaper workspace setup has to remove.",
      query: `sort_desc(${CI_STEP_WORKSPACE_LOGICAL_BYTES_24H} / on(step) ${CI_STEP_WORKSPACES_24H})`,
      legend: "{{step}}",
      gridPos: { x: 12, y: 107, w: 12, h: 8 },
      unit: "decbytes",
      instant: true,
      thresholds: [{ value: 0, color: "blue" }],
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "ZFS Block Cloning Savings",
      targets: [
        {
          query: "zfs_zpool_bclonesaved_bytes",
          legend: "{{node}} · {{zpool_name}} saved",
        },
        {
          query: "zfs_zpool_bcloneused_bytes",
          legend: "{{node}} · {{zpool_name}} cloned blocks",
        },
      ],
      gridPos: { x: 0, y: 115, w: 12, h: 8 },
      unit: "bytes",
    }),
  );
}
