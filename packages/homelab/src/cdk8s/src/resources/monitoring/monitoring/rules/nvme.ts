import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

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
            "nvme_percentage_used_ratio > 0.5",
          ),
          for: "1h",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "NVMe wear above 50% on {{ $labels.device }}",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.device }} reports SMART percentage_used at {{ $value | humanizePercentage }}. Begin replacement planning.",
            ),
          },
        },
        {
          alert: "NvmePercentageUsedCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "nvme_percentage_used_ratio > 0.8",
          ),
          for: "10m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "NVMe wear above 80% on {{ $labels.device }}",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.device }} reports SMART percentage_used at {{ $value | humanizePercentage }}. Replace before reaching 1.0 (end-of-life prediction).",
            ),
          },
        },

        // Available spare capacity. Drops below firmware-defined threshold means
        // reserved blocks for replacement are exhausting; failure is approaching
        // even before percentage_used hits 1.0.
        {
          alert: "NvmeAvailableSpareLow",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "nvme_available_spare_ratio < nvme_available_spare_threshold_ratio",
          ),
          for: "10m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "NVMe available spare below firmware threshold on {{ $labels.device }}",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.device }} reports available_spare {{ $value | humanizePercentage }}, below the device's own warning threshold. Replace.",
            ),
          },
        },

        // Any media error indicates uncorrectable read/write failures at the NAND level.
        {
          alert: "NvmeMediaErrors",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(nvme_media_errors_total[1h]) > 0",
          ),
          for: "5m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "NVMe media errors detected on {{ $labels.device }}",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.device }} accumulated {{ $value }} media errors in the last hour. Investigate and consider replacement.",
            ),
          },
        },

        // Thermal alerts using the working nvme_temperature_celsius metric.
        // The existing SmartNvmeTemperatureHigh/Critical in smartctl.ts use
        // smartmon_temperature_celsius_value, which the smartmon-collector
        // emits with an empty `device` label on this cluster — meaning the
        // device=~".*/nvme[0-9].*" filter never matches and those alerts
        // never fire for NVMe drives. (Coincidentally, the SATA fallback
        // SmartDeviceTemperature* alerts catch them because the empty-device
        // negation matches; that's fragile and misleadingly named.)
        // These NVMe-specific alerts use the node-exporter nvme collector,
        // which emits proper `device=nvme[0-9]+n[0-9]+` labels.
        {
          alert: "NvmeTemperatureHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "nvme_temperature_celsius > 65",
          ),
          for: "5m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "Elevated NVMe temperature on {{ $labels.device }}",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.device }} is {{ $value }}°C. Samsung 990 PRO rated operating max is 70°C; thermal throttling kicks in at the limit.",
            ),
          },
        },
        {
          alert: "NvmeTemperatureCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "nvme_temperature_celsius > 70",
          ),
          for: "1m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "NVMe at thermal throttle limit on {{ $labels.device }}",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.device }} is {{ $value }}°C — at or above Samsung 990 PRO rated operating limit. Dynamic Thermal Guard is throttling write bandwidth, extending CI burst windows in a self-reinforcing loop.",
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
