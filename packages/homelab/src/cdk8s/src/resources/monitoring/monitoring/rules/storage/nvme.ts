import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";
import {
  CI_NODE_HOSTNAME,
  PROD_NODE_HOSTNAME,
} from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { CI_WORKSPACE_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";

// nvme_* metrics are keyed by `device` (e.g. nvme0n1) — the kernel's NVMe
// enumeration name, which is NOT stable across reboots or slot changes. The
// stable serial + model live only on the nvme_device_info metric, so join it in
// via group_left: every alert then carries `serial` and `model` and identifies
// the physical drive instead of an enumeration slot. The join is evaluated per
// scrape, so it always reflects the current device->serial mapping even when the
// enumeration order flips. nvme_device_info has value 1, so the multiplication
// leaves the alert's `$value` unchanged.
function withNvmeIdentity(expr: string): string {
  return `(${expr}) * on(device, instance) group_left(serial, model) nvme_device_info`;
}

// Rate and trend rules look back days, across reboots that can swap device
// names. Aggregating the identity-joined series by serial before the range
// subquery keeps one continuous series per physical drive; a device-keyed range
// would splice two drives together after a swap. `node` rides along so the
// pool and per-node rules can join on it.
function bySerial(metric: string): string {
  return `max by (node, instance, serial, model) (${withNvmeIdentity(metric)})`;
}

// nvme_data_units_written_total counts units of 1000 512-byte sectors.
const NVME_DATA_UNIT_BYTES = 512_000;

/**
 * Each `zfspv-pool-nvme` pool is one whole NVMe drive (see the ZFS pool
 * creation steps in packages/homelab/README.md). No exported metric links a
 * pool to its vdev, so the pairing is declared here, and replacing a pool drive
 * must update its serial. The other NVMe on each node is the Talos OS disk,
 * selected by serial in src/talos/<node>/patches/image.yaml.
 */
export const NVME_POOL_DRIVES = [
  {
    node: PROD_NODE_HOSTNAME,
    zpool: "zfspv-pool-nvme",
    serial: "S7KGNU0X511734N",
  },
  {
    node: CI_NODE_HOSTNAME,
    zpool: "zfspv-pool-nvme",
    serial: "S7L9NJ0L312632A",
  },
] as const;

// Samsung 990 PRO endurance: 600 TBW per TB of capacity over the warranty.
const RATED_WRITES_PER_CAPACITY = 600;
// Every drive's write budget spends its remaining life over this many years.
const WRITE_BUDGET_YEARS = 5;
const DAYS_PER_YEAR = 365;

// Recorded series. Drive series carry (node, instance, serial, model); pool
// series carry (node, zpool). Bytes are decimal, so Grafana's `decbytes` unit
// reads them directly as GB.
export const NVME_DRIVE_WRITTEN_BYTES_24H =
  "nvme_drive:physical_written_bytes:increase24h";
export const NVME_DRIVE_WRITTEN_BYTES_PER_DAY_7D =
  "nvme_drive:physical_written_bytes_per_day:avg7d";
export const NVME_DRIVE_WEAR_PER_WRITTEN_BYTE =
  "nvme_drive:wear_ratio_per_written_byte:conservative";
export const NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY =
  "nvme_drive:write_budget_bytes_per_day:5y";
export const ZFS_POOL_LOGICAL_WRITTEN_BYTES_24H =
  "zfs_pool:logical_written_bytes:increase24h";
export const ZFS_POOL_PHYSICAL_WRITTEN_BYTES_24H =
  "zfs_pool:physical_written_bytes:increase24h";
export const ZFS_POOL_WRITE_AMPLIFICATION_24H =
  "zfs_pool:write_amplification:ratio24h";
export const CI_WORKSPACE_PHYSICAL_BYTES_PER_PVC_24H =
  "ci_workspace:physical_written_bytes_per_pvc:ratio24h";

const usedRatio = bySerial("nvme_percentage_used_ratio");
const lifetimeWrittenBytes = `${bySerial("nvme_data_units_written_total")} * ${String(NVME_DATA_UNIT_BYTES)}`;
const capacityBytes = bySerial("nvme_physical_size_bytes");

// Wear per written byte, taking whichever of two estimates wears faster:
//  - observed: SMART percentage_used over lifetime bytes written. This is the
//    drive's real per-byte wear including its internal amplification (the
//    torvalds pool drive, ashift=9, wears about twice as fast as rated).
//  - rated: one full life per RATED_WRITES_PER_CAPACITY capacities written.
// percentage_used moves in whole-percent steps, so a young drive's observed
// figure is 0 or coarse. The rated floor keeps its budget finite and sane
// instead of dividing by zero; clamp_min guards a zero byte count.
const observedWearPerByte = `${usedRatio} / clamp_min(${lifetimeWrittenBytes}, 1)`;
const ratedWearPerByte = `1 / (${String(RATED_WRITES_PER_CAPACITY)} * ${capacityBytes})`;

// Each pool drive's physical writes, re-keyed by (node, zpool).
const poolPhysicalWrites = NVME_POOL_DRIVES.map(
  ({ node, zpool, serial }) =>
    `max by (node, zpool) (label_replace(${NVME_DRIVE_WRITTEN_BYTES_24H}{node="${node}",serial="${serial}"}, "zpool", "${zpool}", "", ""))`,
).join(" or ");

function ciPoolDrive(): (typeof NVME_POOL_DRIVES)[number] {
  const drive = NVME_POOL_DRIVES.find(
    (candidate) => candidate.node === CI_NODE_HOSTNAME,
  );
  if (drive === undefined) {
    throw new Error("The CI node's NVMe pool drive must be declared");
  }
  return drive;
}

/**
 * Write-budget recording rules. Evaluated every 5 minutes: they summarize
 * day-scale windows, so a faster cadence would only repeat the same subquery
 * work.
 */
function getNvmeWriteBudgetRuleGroup(): PrometheusRuleSpecGroups {
  const ciPool = ciPoolDrive();
  return {
    name: "nvme-write-budget.rules",
    interval: "5m",
    rules: [
      // Physical bytes the host wrote to each drive: what wears the flash.
      {
        record: NVME_DRIVE_WRITTEN_BYTES_24H,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `increase(${bySerial("nvme_data_units_written_total")}[24h:5m]) * ${String(NVME_DATA_UNIT_BYTES)}`,
        ),
      },
      {
        record: NVME_DRIVE_WRITTEN_BYTES_PER_DAY_7D,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `increase(${bySerial("nvme_data_units_written_total")}[7d:1h]) * ${String(NVME_DATA_UNIT_BYTES)} / 7`,
        ),
      },
      {
        record: NVME_DRIVE_WEAR_PER_WRITTEN_BYTE,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `((${observedWearPerByte}) >= (${ratedWearPerByte})) or (${ratedWearPerByte})`,
        ),
      },
      // Bytes per day that spend the remaining life over WRITE_BUDGET_YEARS:
      // (1 - used) / (years * 365) / wear per byte.
      {
        record: NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `clamp_min(1 - ${usedRatio}, 0) / ${String(WRITE_BUDGET_YEARS * DAYS_PER_YEAR)} / on(node, instance, serial, model) ${NVME_DRIVE_WEAR_PER_WRITTEN_BYTE}`,
        ),
      },
      // Logical bytes applications wrote into each pool's datasets. A dataset
      // destroyed inside the window loses its last unscraped writes, so this
      // slightly understates churny pools such as the CI pool.
      {
        record: ZFS_POOL_LOGICAL_WRITTEN_BYTES_24H,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "sum by (node, zpool) (increase(node_zfs_zpool_dataset_nwritten[24h]))",
        ),
      },
      {
        record: ZFS_POOL_PHYSICAL_WRITTEN_BYTES_24H,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(poolPhysicalWrites),
      },
      // Physical bytes reaching the flash per logical byte written: record
      // size, metadata, ZIL, and copy-on-write overhead together.
      {
        record: ZFS_POOL_WRITE_AMPLIFICATION_24H,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `${ZFS_POOL_PHYSICAL_WRITTEN_BYTES_24H} / on(node, zpool) (${ZFS_POOL_LOGICAL_WRITTEN_BYTES_24H} > 0)`,
        ),
      },
      // CI pool physical bytes per workspace claim that existed in the window.
      // Counting by (namespace, claim) dedupes series a kube-state-metrics
      // restart splits.
      {
        record: CI_WORKSPACE_PHYSICAL_BYTES_PER_PVC_24H,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `${ZFS_POOL_PHYSICAL_WRITTEN_BYTES_24H}{node="${ciPool.node}",zpool="${ciPool.zpool}"} / on() group_left() (count(count by (namespace, persistentvolumeclaim) (last_over_time(kube_persistentvolumeclaim_info{storageclass="${CI_WORKSPACE_STORAGE_CLASS}"}[24h]))) > 0)`,
        ),
      },
    ],
  };
}

// Days until SMART percentage_used reaches 1.0 at the last 14 days' wear rate.
// percentage_used moves in whole-percent steps, so a shorter window is too
// coarse. A drive with no recent wear divides by zero and yields +Inf.
const projectedWearOutDays = `(1 - ${bySerial("nvme_percentage_used_ratio")}) / (delta(${bySerial("nvme_percentage_used_ratio")}[14d:1h]) / 14)`;

export function getNvmeRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "nvme.rules",
      interval: "1m",
      rules: [
        // NVMe controller-reported wear (percentage_used_ratio: 0.0 = unused, 1.0 = end-of-life).
        // Source: nvme-cli SMART/Health Information log, surfaced by node-exporter's nvme collector.
        // This is the actually-working SSD wear metric on this cluster — smartmon_wear_leveling_count_value
        // is not reported (see TODO in smartctl.ts).
        {
          alert: "NvmePercentageUsedHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withNvmeIdentity("nvme_percentage_used_ratio > 0.5"),
          ),
          for: "1h",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "NVMe wear above 50% on {{ $labels.model }} (serial {{ $labels.serial }})",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.model }} (serial {{ $labels.serial }}, dev {{ $labels.device }}) reports SMART percentage_used at {{ $value | humanizePercentage }}. Begin replacement planning.",
            ),
          },
        },
        {
          alert: "NvmePercentageUsedCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withNvmeIdentity("nvme_percentage_used_ratio > 0.8"),
          ),
          for: "10m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "NVMe wear above 80% on {{ $labels.model }} (serial {{ $labels.serial }})",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.model }} (serial {{ $labels.serial }}, dev {{ $labels.device }}) reports SMART percentage_used at {{ $value | humanizePercentage }}. Replace before reaching 1.0 (end-of-life prediction).",
            ),
          },
        },

        // Wear velocity. The absolute thresholds above fire only once half the
        // drive's rated life is gone; these fire on the trend, while there is
        // still time to cut writes or schedule a replacement.
        //
        // The write budget covers every NVMe, OS disks included, over a
        // trailing 24h window: a new workload that lands on a node's OS disk
        // crosses it the same day instead of surfacing in a wear review weeks
        // later.
        {
          alert: "NvmeWriteBudgetExceeded",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${NVME_DRIVE_WRITTEN_BYTES_24H} > on(node, instance, serial, model) ${NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY}`,
          ),
          for: "30m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "NVMe writes exceed the 5-year budget on {{ $labels.node }} {{ $labels.model }} (serial {{ $labels.serial }})",
            ),
            description: escapePrometheusTemplate(
              `NVMe {{ $labels.model }} (serial {{ $labels.serial }}) on {{ $labels.node }} took {{ $value | humanize }}B of physical writes in the last 24h, more than the daily budget that stretches its remaining life over ${String(WRITE_BUDGET_YEARS)} years (${NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY}). Find the writer in the top-datasets panel of the SMART Monitoring dashboard and cut it.`,
            ),
          },
        },
        {
          alert: "NvmeWearOutProjectedWithinYear",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(${projectedWearOutDays}) < 365`,
          ),
          for: "6h",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "NVMe projected to reach rated wear within a year on {{ $labels.model }} (serial {{ $labels.serial }})",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.model }} (serial {{ $labels.serial }}) reaches SMART percentage_used 100% in about {{ $value | humanize }} days at its 14-day wear rate. Cut writes or plan a replacement.",
            ),
          },
        },
        {
          alert: "NvmeWearOutProjectedWithinSixMonths",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(${projectedWearOutDays}) < 180`,
          ),
          for: "6h",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "NVMe projected to reach rated wear within six months on {{ $labels.model }} (serial {{ $labels.serial }})",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.model }} (serial {{ $labels.serial }}) reaches SMART percentage_used 100% in about {{ $value | humanize }} days at its 14-day wear rate. Have a replacement on hand and cut writes now.",
            ),
          },
        },

        // Available spare capacity. Drops below firmware-defined threshold means
        // reserved blocks for replacement are exhausting; failure is approaching
        // even before percentage_used hits 1.0.
        {
          alert: "NvmeAvailableSpareLow",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withNvmeIdentity(
              "nvme_available_spare_ratio < nvme_available_spare_threshold_ratio",
            ),
          ),
          for: "10m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "NVMe available spare below firmware threshold on {{ $labels.model }} (serial {{ $labels.serial }})",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.model }} (serial {{ $labels.serial }}, dev {{ $labels.device }}) reports available_spare {{ $value | humanizePercentage }}, below the device's own warning threshold. Replace.",
            ),
          },
        },

        // Any media error indicates uncorrectable read/write failures at the NAND level.
        {
          alert: "NvmeMediaErrors",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withNvmeIdentity("increase(nvme_media_errors_total[1h]) > 0"),
          ),
          for: "5m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "NVMe media errors detected on {{ $labels.model }} (serial {{ $labels.serial }})",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.model }} (serial {{ $labels.serial }}, dev {{ $labels.device }}) accumulated {{ $value }} media errors in the last hour. Investigate and consider replacement.",
            ),
          },
        },

        // Thermal alerts using the nvme_temperature_celsius metric (node-exporter
        // nvme collector), which emits proper `device=nvme[0-9]+n[0-9]+` labels.
        // The smartmon collector emits temperature without a usable device label
        // for NVMe, so NVMe temperature is owned here, not in smartctl.ts (whose
        // temp alerts are now scoped to SATA via type="sat").
        {
          alert: "NvmeTemperatureHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withNvmeIdentity("nvme_temperature_celsius > 65"),
          ),
          for: "5m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "Elevated NVMe temperature on {{ $labels.model }} (serial {{ $labels.serial }})",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.model }} (serial {{ $labels.serial }}, dev {{ $labels.device }}) is {{ $value }}°C. Samsung 990 PRO rated operating max is 70°C; thermal throttling kicks in at the limit.",
            ),
          },
        },
        {
          alert: "NvmeTemperatureCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withNvmeIdentity("nvme_temperature_celsius > 70"),
          ),
          for: "1m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "NVMe at thermal throttle limit on {{ $labels.model }} (serial {{ $labels.serial }})",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.model }} (serial {{ $labels.serial }}, dev {{ $labels.device }}) is {{ $value }}°C — at or above Samsung 990 PRO rated operating limit. Dynamic Thermal Guard is throttling write bandwidth, extending CI burst windows in a self-reinforcing loop.",
            ),
          },
        },

        // Raw-throughput alerts live in prometheus-resource-monitoring-rules
        // (HighDiskWriteActivity, SustainedDiskWriteActivity,
        // NodeDiskIOSaturation) and exclude the CI node, whose bursts are
        // expected. The endurance-normalized rules above cover every node,
        // including the CI node, because wear is what ends a drive.
      ],
    },
    getNvmeWriteBudgetRuleGroup(),
  ];
}
