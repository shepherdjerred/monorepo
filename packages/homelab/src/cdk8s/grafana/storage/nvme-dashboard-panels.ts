import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import {
  createStatPanel,
  createTimeseriesPanel,
} from "@shepherdjerred/homelab/cdk8s/grafana/shared/dashboard-panels.ts";

const NVME_INFO = 'nvme_device_info{serial=~"$serial"}';

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
      title: "NVMe Drive Writes per Day (7d)",
      description:
        "Average full-drive writes per day over 7 days. Samsung 990 PRO endurance is about 0.33 per day (600 TBW per TB over 5 years).",
      query: `increase(${bySerial("nvme_data_units_written_total")}[7d:1h]) * ${String(DATA_UNIT_BYTES)} / 7 / ${bySerial("nvme_physical_size_bytes")}`,
      legend: "{{model}} · {{serial}}",
      gridPos: { x: 8, y: 86, w: 8, h: 4 },
      unit: "none",
      instant: true,
      thresholds: [
        { value: 0, color: "green" },
        { value: 0.33, color: "orange" },
        { value: 0.5, color: "red" },
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
}
