import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

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
// would splice two drives together after a swap.
function bySerial(metric: string): string {
  return `max by (instance, serial, model) (${withNvmeIdentity(metric)})`;
}

// nvme_data_units_written_total counts units of 1000 512-byte sectors.
const NVME_DATA_UNIT_BYTES = 512_000;

// Consumer TLC drives in this cluster (Samsung 990 PRO) are rated for 600 TBW
// per TB over a 5-year warranty, about 0.33 drive writes per day. Alert at 1.5x
// that so normal production churn stays quiet.
const DRIVE_WRITES_PER_DAY_LIMIT = 0.5;

const driveWritesPerDay7d = `increase(${bySerial("nvme_data_units_written_total")}[7d:1h]) * ${String(NVME_DATA_UNIT_BYTES)} / 7 / ${bySerial("nvme_physical_size_bytes")}`;

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
        {
          alert: "NvmeWriteRateAboveEndurance",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(${driveWritesPerDay7d}) > ${String(DRIVE_WRITES_PER_DAY_LIMIT)}`,
          ),
          for: "6h",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "NVMe writes exceed rated endurance on {{ $labels.model }} (serial {{ $labels.serial }})",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.model }} (serial {{ $labels.serial }}) averaged {{ $value | humanize }} drive writes per day over 7 days. Its rated endurance is about 0.33 per day; find and cut the write source.",
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
  ];
}
