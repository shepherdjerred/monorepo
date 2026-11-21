import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";
import { smartTemperatureCelsiusExpression } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/smartmon-metrics.ts";

// smartmon_* metrics are keyed by `disk` (e.g. /dev/nvme0, /dev/sda) — the device
// path assigned at scan time, which is NOT stable across reboots or controller
// re-enumeration. The stable serial_number + device_model live only on the
// smartmon_device_info metric, so join it in via group_left: every alert then
// carries serial_number + device_model and identifies the physical drive instead
// of a /dev path. The join is evaluated per scrape, so it always reflects the
// current disk->serial mapping even when enumeration flips. smartmon_device_info
// has value 1, so the multiplication leaves the alert's `$value` unchanged.
//
// This also fixes annotations that previously referenced {{ $labels.device }} and
// {{ $labels.model_name }} — neither label exists on smartmon_* metrics (they
// carry `disk`/`type`/`smart_id`), so those annotations rendered blank.
function withSmartIdentity(expr: string): string {
  return `(${expr}) * on(disk, instance) group_left(serial_number, device_model) smartmon_device_info`;
}

export function getSmartctlRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "smartctl.rules",
      interval: "30s",
      rules: [
        // SMART Health Status Rules
        {
          alert: "SmartDeviceHealthFailure",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withSmartIdentity("smartmon_device_smart_healthy == 0"),
          ),
          for: "0m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: "SSD health check failed",
            description: escapePrometheusTemplate(
              "Drive {{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) failed its SMART overall health self-assessment, indicating imminent hardware failure and risk of data loss. Verify ZFS pool redundancy immediately and replace the drive.",
            ),
          },
        },

        // Temperature: SATA only (type!="nvme"). NVMe temperature is owned by the
        // nvme.rules group (NvmeTemperatureHigh/Critical), which uses the
        // node-exporter nvme collector's properly-labelled nvme_temperature_celsius.
        // SATA (Samsung 870 EVO) keeps 60°C/70°C thresholds — a SATA SSD in a
        // homelab should not reach 60°C; if it does it indicates a real problem.
        {
          alert: "SmartDeviceTemperatureHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withSmartIdentity(
              `${smartTemperatureCelsiusExpression(true)} > 60`,
            ),
          ),
          for: "5m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: "SATA drive temperature is high",
            description: escapePrometheusTemplate(
              "SATA drive {{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) is at {{ $value }}°C, above the 60°C warning threshold, which accelerates drive wear. Check host ambient temperature, fan speeds, and airflow around the drive bay.",
            ),
          },
        },
        {
          alert: "SmartDeviceTemperatureCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withSmartIdentity(
              `${smartTemperatureCelsiusExpression(true)} > 70`,
            ),
          ),
          for: "1m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: "SATA drive temperature is critically high",
            description: escapePrometheusTemplate(
              "SATA drive {{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) is at {{ $value }}°C, exceeding the 70°C operating limit and risking thermal damage or sudden failure. Restore host cooling immediately and reduce disk I/O load.",
            ),
          },
        },

        // Reallocated Sectors
        {
          alert: "SmartReallocatedSectorsHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withSmartIdentity("smartmon_reallocated_sector_ct_raw_value > 0"),
          ),
          for: "0m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: "Drive has reallocated bad sectors",
            description: escapePrometheusTemplate(
              "Drive {{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) has {{ $value }} reallocated sector(s), indicating early media degradation. Verify backups and ZFS scrub health and check whether the reallocated sector count continues growing.",
            ),
          },
        },
        {
          alert: "SmartReallocatedSectorsCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withSmartIdentity("smartmon_reallocated_sector_ct_raw_value > 10"),
          ),
          for: "0m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: "Drive has a high number of bad sectors",
            description: escapePrometheusTemplate(
              "Drive {{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) has {{ $value }} reallocated sectors, indicating significant media degradation and elevated failure risk. Run a ZFS scrub to verify data integrity and schedule a drive replacement.",
            ),
          },
        },

        // Pending Sectors
        {
          alert: "SmartPendingSectorsHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withSmartIdentity("smartmon_current_pending_sector_raw_value > 0"),
          ),
          for: "5m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: "Drive has unreadable sectors awaiting repair",
            description: escapePrometheusTemplate(
              "Drive {{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) has {{ $value }} unstable sector(s) awaiting reallocation, which can cause read errors. Run a ZFS scrub and check whether pending or uncorrectable sector counts increase.",
            ),
          },
        },
        {
          alert: "SmartPendingSectorsCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withSmartIdentity("smartmon_current_pending_sector_raw_value > 5"),
          ),
          for: "1m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: "Drive has critical unreadable sectors",
            description: escapePrometheusTemplate(
              "Drive {{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) has {{ $value }} unstable sectors awaiting reallocation, risking unrecoverable read errors. Verify ZFS pool health and replace the drive promptly.",
            ),
          },
        },

        // Uncorrectable Errors
        {
          alert: "SmartUncorrectableErrors",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withSmartIdentity("smartmon_offline_uncorrectable_raw_value > 0"),
          ),
          for: "0m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: "Drive reported unrecoverable sector errors",
            description: escapePrometheusTemplate(
              "Drive {{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) reported {{ $value }} offline uncorrectable sector error(s), risking data corruption or read failures. Check ZFS pool status for checksum or read errors and replace the drive.",
            ),
          },
        },

        // UDMA CRC Error Count (SATA cable/interface issues)
        {
          alert: "SmartUdmaCrcErrorsHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withSmartIdentity("smartmon_udma_crc_error_count_raw_value > 0"),
          ),
          for: "5m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: "SATA drive cable reported data transfer errors",
            description: escapePrometheusTemplate(
              "Drive {{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) has {{ $value }} UDMA CRC communication error(s), which can cause I/O retries or link resets. Replace or reseat the SATA data cable and check the controller port if the error count keeps climbing.",
            ),
          },
        },

        // Power Cycle Count (wear monitoring)
        {
          alert: "SmartHighPowerCycles",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withSmartIdentity("smartmon_power_cycle_count_raw_value > 10000"),
          ),
          for: "0m",
          labels: {
            severity: "info",
            category: "hardware",
          },
          annotations: {
            summary: "Drive has an unusually high power-cycle count",
            description: escapePrometheusTemplate(
              "Drive {{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) has logged {{ $value }} power cycles, which may reflect aggressive power management or unstable power delivery. Check host power-saving settings and PSU/power cable stability.",
            ),
          },
        },

        // SSD-specific rules.
        // NOTE: smartmon_wear_leveling_count_value is not currently reported by the
        // smartmon collector on this cluster, so these never fire. NVMe wear is
        // covered by NvmePercentageUsed{High,Critical} in nvme.rules. Kept (with
        // stable-identity annotations) so they work if SATA wear data appears.
        {
          alert: "SmartSsdWearLevelingHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withSmartIdentity("smartmon_wear_leveling_count_value < 10"),
          ),
          for: "5m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: "SSD remaining wear reserve is below 10%",
            description: escapePrometheusTemplate(
              "SSD {{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) reports a SMART wear-leveling value of {{ $value }} (below 10% remaining life). Review write-heavy workloads on the drive and plan a replacement.",
            ),
          },
        },
        {
          alert: "SmartSsdWearLevelingCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withSmartIdentity("smartmon_wear_leveling_count_value < 5"),
          ),
          for: "1m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: "SSD remaining wear reserve is below 5%",
            description: escapePrometheusTemplate(
              "SSD {{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) reports a SMART wear-leveling value of {{ $value }} (below 5% remaining life), risking sudden read-only mode or failure. Replace the drive immediately.",
            ),
          },
        },
      ],
    },
    {
      name: "smartctl.recording.rules",
      interval: "30s",
      rules: [
        // Recording rules for better performance and easier querying
        {
          record: "smartmon:device_healthy",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "smartmon_device_smart_healthy",
          ),
        },
        {
          record: "smartmon:temperature_celsius",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            smartTemperatureCelsiusExpression(),
          ),
        },
        {
          record: "smartmon:reallocated_sectors_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "smartmon_reallocated_sector_ct_raw_value",
          ),
        },
        {
          record: "smartmon:pending_sectors_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "smartmon_current_pending_sector_raw_value",
          ),
        },
        {
          record: "smartmon:uncorrectable_errors_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "smartmon_offline_uncorrectable_raw_value",
          ),
        },
        // Aggregate health metrics per node
        {
          record: "smartmon:node_unhealthy_devices",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'count by (instance) (smartmon_device_smart_healthy{smartmon_device_smart_healthy="0"})',
          ),
        },
        {
          record: "smartmon:node_total_devices",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "count by (instance) (smartmon_device_smart_healthy)",
          ),
        },
        {
          record: "smartmon:node_health_ratio",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "smartmon:node_unhealthy_devices / smartmon:node_total_devices",
          ),
        },
      ],
    },
  ];
}
