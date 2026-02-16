import type { PrometheusRuleSpecGroups } from "../../../../../generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "../../../../../generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared";

export function getSmartctlRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "smartctl.rules",
      interval: "30s",
      rules: [
        // SMART Health Status Rules
        {
          alert: "SmartDeviceHealthFailure",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_device_smart_healthy == 0"),
          for: "0m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate("SMART health check failed for device {{ $labels.device }}"),
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} ({{ $labels.model_name }}) has failed SMART health check. Serial: {{ $labels.serial_number }}",
            ),
          },
        },
        {
          alert: "SmartDeviceTemperatureHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_temperature_celsius_value > 60"),
          for: "5m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate("High temperature detected on device {{ $labels.device }}"),
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} ({{ $labels.model_name }}) temperature is {{ $value }}°C, which is above the warning threshold of 60°C",
            ),
          },
        },
        {
          alert: "SmartDeviceTemperatureCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_temperature_celsius_value > 70"),
          for: "1m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate("Critical temperature detected on device {{ $labels.device }}"),
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} ({{ $labels.model_name }}) temperature is {{ $value }}°C, which is above the critical threshold of 70°C",
            ),
          },
        },

        // Reallocated Sectors
        {
          alert: "SmartReallocatedSectorsHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_reallocated_sector_ct_raw_value > 0"),
          for: "0m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate("Reallocated sectors detected on device {{ $labels.device }}"),
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} ({{ $labels.model_name }}) has {{ $value }} reallocated sectors. This may indicate disk degradation.",
            ),
          },
        },
        {
          alert: "SmartReallocatedSectorsCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_reallocated_sector_ct_raw_value > 10"),
          for: "0m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate("High number of reallocated sectors on device {{ $labels.device }}"),
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} ({{ $labels.model_name }}) has {{ $value }} reallocated sectors, indicating significant disk degradation.",
            ),
          },
        },

        // Pending Sectors
        {
          alert: "SmartPendingSectorsHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_current_pending_sector_raw_value > 0"),
          for: "5m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate("Pending sectors detected on device {{ $labels.device }}"),
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} ({{ $labels.model_name }}) has {{ $value }} pending sectors waiting for reallocation.",
            ),
          },
        },
        {
          alert: "SmartPendingSectorsCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_current_pending_sector_raw_value > 5"),
          for: "1m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate("High number of pending sectors on device {{ $labels.device }}"),
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} ({{ $labels.model_name }}) has {{ $value }} pending sectors, indicating potential hardware failure.",
            ),
          },
        },

        // Uncorrectable Errors
        {
          alert: "SmartUncorrectableErrors",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_offline_uncorrectable_raw_value > 0"),
          for: "0m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate("Uncorrectable errors detected on device {{ $labels.device }}"),
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} ({{ $labels.model_name }}) has {{ $value }} uncorrectable errors. This indicates serious disk problems.",
            ),
          },
        },

        // UDMA CRC Error Count (for SATA drives)
        {
          alert: "SmartUdmaCrcErrorsHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_udma_crc_error_count_raw_value > 0"),
          for: "5m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate("UDMA CRC errors detected on device {{ $labels.device }}"),
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} ({{ $labels.model_name }}) has {{ $value }} UDMA CRC errors. This may indicate cable or interface problems.",
            ),
          },
        },

        // Power Cycle Count (for wear monitoring)
        {
          alert: "SmartHighPowerCycles",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_power_cycle_count_raw_value > 10000"),
          for: "0m",
          labels: {
            severity: "info",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate("High power cycle count on device {{ $labels.device }}"),
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} ({{ $labels.model_name }}) has {{ $value }} power cycles, which is quite high for typical usage.",
            ),
          },
        },

        // SSD-specific rules
        {
          alert: "SmartSsdWearLevelingHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_wear_leveling_count_value < 10"),
          for: "5m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate("SSD wear leveling count low on device {{ $labels.device }}"),
            description: escapePrometheusTemplate(
              "SSD {{ $labels.device }} ({{ $labels.model_name }}) wear leveling count is {{ $value }}, indicating high wear level.",
            ),
          },
        },
        // TODO: this doesn't seem to exist
        {
          alert: "SmartSsdWearLevelingCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_wear_leveling_count_value < 5"),
          for: "1m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate("SSD wear leveling critically low on device {{ $labels.device }}"),
            description: escapePrometheusTemplate(
              "SSD {{ $labels.device }} ({{ $labels.model_name }}) wear leveling count is {{ $value }}, indicating critical wear level.",
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
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_device_smart_healthy"),
        },
        {
          record: "smartmon:temperature_celsius",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_temperature_celsius_value"),
        },
        {
          record: "smartmon:power_on_hours",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_power_on_hours_values"),
        },
        {
          record: "smartmon:reallocated_sectors_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_reallocated_sector_ct_raw_value"),
        },
        {
          record: "smartmon:pending_sectors_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_current_pending_sector_raw_value"),
        },
        {
          record: "smartmon:uncorrectable_errors_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("smartmon_offline_uncorrectable_raw_value"),
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
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("count by (instance) (smartmon_device_smart_healthy)"),
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
