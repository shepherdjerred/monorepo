import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

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
  return `(${expr}) * on(disk) group_left(serial_number, device_model) smartmon_device_info`;
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
            summary: escapePrometheusTemplate(
              "SMART health check failed for {{ $labels.device_model }} (serial {{ $labels.serial_number }})",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) has failed its SMART health check.",
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
              'smartmon_temperature_celsius_value{type!="nvme"} > 60',
            ),
          ),
          for: "5m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "High temperature on {{ $labels.device_model }} (serial {{ $labels.serial_number }})",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) is {{ $value }}°C, above the 60°C warning threshold.",
            ),
          },
        },
        {
          alert: "SmartDeviceTemperatureCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withSmartIdentity(
              'smartmon_temperature_celsius_value{type!="nvme"} > 70',
            ),
          ),
          for: "1m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "Critical temperature on {{ $labels.device_model }} (serial {{ $labels.serial_number }})",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) is {{ $value }}°C, above the 70°C critical threshold.",
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
            summary: escapePrometheusTemplate(
              "Reallocated sectors on {{ $labels.device_model }} (serial {{ $labels.serial_number }})",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) has {{ $value }} reallocated sectors. This may indicate disk degradation.",
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
            summary: escapePrometheusTemplate(
              "High reallocated sector count on {{ $labels.device_model }} (serial {{ $labels.serial_number }})",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) has {{ $value }} reallocated sectors, indicating significant disk degradation.",
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
            summary: escapePrometheusTemplate(
              "Pending sectors on {{ $labels.device_model }} (serial {{ $labels.serial_number }})",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) has {{ $value }} pending sectors waiting for reallocation.",
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
            summary: escapePrometheusTemplate(
              "High pending sector count on {{ $labels.device_model }} (serial {{ $labels.serial_number }})",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) has {{ $value }} pending sectors, indicating potential hardware failure.",
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
            summary: escapePrometheusTemplate(
              "Uncorrectable errors on {{ $labels.device_model }} (serial {{ $labels.serial_number }})",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) has {{ $value }} uncorrectable errors. This indicates serious disk problems.",
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
            summary: escapePrometheusTemplate(
              "UDMA CRC errors on {{ $labels.device_model }} (serial {{ $labels.serial_number }})",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) has {{ $value }} UDMA CRC errors. This may indicate cable or interface problems.",
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
            summary: escapePrometheusTemplate(
              "High power cycle count on {{ $labels.device_model }} (serial {{ $labels.serial_number }})",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) has {{ $value }} power cycles, which is quite high for typical usage.",
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
            summary: escapePrometheusTemplate(
              "SSD wear leveling count low on {{ $labels.device_model }} (serial {{ $labels.serial_number }})",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) wear leveling count is {{ $value }}, indicating high wear level.",
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
            summary: escapePrometheusTemplate(
              "SSD wear leveling critically low on {{ $labels.device_model }} (serial {{ $labels.serial_number }})",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.device_model }} (serial {{ $labels.serial_number }}, {{ $labels.disk }}) wear leveling count is {{ $value }}, indicating critical wear level.",
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
            "smartmon_temperature_celsius_value",
          ),
        },
        {
          record: "smartmon:power_on_hours",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "smartmon_power_on_hours_values",
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
