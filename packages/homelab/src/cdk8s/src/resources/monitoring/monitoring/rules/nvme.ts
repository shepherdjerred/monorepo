import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

// nvme_* metrics are keyed by `device` (e.g. nvme0n1) — the kernel's NVMe
// enumeration name, which is NOT stable across reboots or slot changes. The
// stable serial + model live only on the nvme_device_info metric, so join it in
// via group_left: every alert then carries `serial` and `model` and identifies
// the physical drive instead of an enumeration slot. The join is evaluated per
// scrape, so it always reflects the current device->serial mapping even when the
// enumeration order flips. nvme_device_info has value 1, so the multiplication
// leaves the alert's `$value` unchanged.
function withNvmeIdentity(expr: string): string {
  return `(${expr}) * on(device) group_left(serial, model) nvme_device_info`;
}

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

        // Note on write-rate regression: deliberately not added here. The
        // existing prometheus-resource-monitoring-rules already cover this:
        //  - HighDiskWriteActivity (SSD, > 50 MB/s for 30m)
        //  - SustainedDiskWriteActivity (SSD, > 1 TB/24h for 1h)
        //  - NodeDiskIOSaturation (queue depth > 10 for 30m)
        // Those use node_disk_info{rotational="0"} which already excludes HDDs.
        // Adding another threshold here would just create alert noise.
      ],
    },
  ];
}
