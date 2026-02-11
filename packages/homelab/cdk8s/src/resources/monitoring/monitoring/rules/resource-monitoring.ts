import {
  PrometheusRuleSpecGroups,
  PrometheusRuleSpecGroupsRulesExpr,
} from "../../../../../generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared";

export function getResourceMonitoringRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    // CPU monitoring
    {
      name: "resource-cpu-monitoring",
      rules: [
        {
          alert: "HighCPUUsageSustained",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has sustained high CPU usage: {{ $value | humanize }}% for over 1 day",
            ),
            summary: "Sustained high CPU usage detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)) > 75',
          ),
          for: "1d",
          labels: { severity: "warning" },
        },
        {
          alert: "VeryHighCPUUsage",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has very high CPU usage: {{ $value | humanizePercentage }}",
            ),
            summary: "Very high CPU usage detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)) > 80',
          ),
          for: "15m",
          labels: { severity: "critical" },
        },
      ],
    },

    // Memory monitoring
    {
      name: "resource-memory-monitoring",
      rules: [
        {
          alert: "HighMemoryPressure",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has high memory pressure: {{ $value | humanizePercentage }} memory usage with low available memory",
            ),
            summary: "High memory pressure detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) > 0.9",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
        {
          alert: "LowMemoryAvailable",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has very low available memory: {{ $value | humanize }} bytes remaining",
            ),
            summary: "Very low memory available",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "node_memory_MemAvailable_bytes < 1073741824", // Less than 1GB
          ),
          for: "5m",
          labels: { severity: "critical" },
        },
        {
          alert: "MemoryLeakSuspected",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} shows potential memory leak: consistent memory growth over 24 hours",
            ),
            summary: "Potential memory leak detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) - (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes offset 24h) > 8589934592", // 8GB increase over 24h (adjusted for ZFS ARC growth)
          ),
          for: "4h",
          labels: { severity: "warning" },
        },
      ],
    },

    // Network monitoring
    {
      name: "resource-network-monitoring",
      rules: [
        {
          alert: "HighNetworkTransmit",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} interface {{ $labels.device }} has high sustained transmit rate: {{ $value | humanize }} bytes/s for over 1 hour",
            ),
            summary: "High network transmit rate sustained",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'rate(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[5m]) > 104857600', // 100MB/s
          ),
          for: "1h",
          labels: { severity: "warning" },
        },
        {
          alert: "HighNetworkReceive",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} interface {{ $labels.device }} has high sustained receive rate: {{ $value | humanize }} bytes/s for over 1 hour",
            ),
            summary: "High network receive rate sustained",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[5m]) > 104857600', // 100MB/s
          ),
          for: "1h",
          labels: { severity: "warning" },
        },
        {
          alert: "UnusualNetworkActivity",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has unusual network activity: {{ $value }} times higher than normal",
            ),
            summary: "Unusual network activity detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'rate(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[5m]) > 10 * rate(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[1h])',
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
      ],
    },

    // Disk monitoring
    {
      name: "resource-disk-monitoring",
      rules: [
        {
          alert: "PVCStorageHigh",
          annotations: {
            description: escapePrometheusTemplate(
              "PVC {{ $labels.namespace }}/{{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full",
            ),
            summary: "PVC storage usage above 90%",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes) > 0.9",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
        {
          alert: "HighDiskUsage",
          annotations: {
            description: escapePrometheusTemplate(
              "Filesystem {{ $labels.mountpoint }} on {{ $labels.instance }} is {{ $value | humanizePercentage }} full",
            ),
            summary: "High disk usage detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(1 - (node_filesystem_avail_bytes{fstype!~"tmpfs|fuse.lxcfs|squashfs"} / node_filesystem_size_bytes)) > 0.85',
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
        {
          alert: "HighDiskWriteActivity",
          annotations: {
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} on {{ $labels.instance }} has high write activity: {{ $value | humanize }} bytes/s (potential SSD wear concern)",
            ),
            summary: "High disk write activity detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max by (instance, device) (rate(node_disk_written_bytes_total[5m])) > 52428800 and on (instance, device) node_disk_info{rotational="0"}', // 50MB/s, SSD only
          ),
          for: "30m",
          labels: { severity: "warning" },
        },
        {
          alert: "SustainedDiskWriteActivity",
          annotations: {
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} on {{ $labels.instance }} wrote {{ $value | humanize }} bytes in the last 24 hours (SSD wear concern)",
            ),
            summary: "Sustained disk write activity detected - SSD wear concern",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(max by (instance, device) (node_disk_written_bytes_total)[24h:5m]) > 1024^4 and on (instance, device) node_disk_info{rotational="0"}', // > 1 TiB/day, SSD only
          ),
          for: "1h",
          labels: { severity: "warning" },
        },
        {
          alert: "DiskIOUtilizationHigh",
          annotations: {
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} on {{ $labels.instance }} has high IO utilization: {{ $value | humanizePercentage }}",
            ),
            summary: "High disk IO utilization",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("rate(node_disk_io_time_seconds_total[5m]) > 0.8"),
          for: "15m",
          labels: { severity: "warning" },
        },
        {
          alert: "DiskReadErrors",
          annotations: {
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} on {{ $labels.instance }} is experiencing read errors: {{ $value }} errors",
            ),
            summary: "Disk read errors detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("increase(node_disk_read_errors_total[1h]) > 0"),
          for: "5m",
          labels: { severity: "critical" },
        },
        {
          alert: "DiskWriteErrors",
          annotations: {
            description: escapePrometheusTemplate(
              "Device {{ $labels.device }} on {{ $labels.instance }} is experiencing write errors: {{ $value }} errors",
            ),
            summary: "Disk write errors detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("increase(node_disk_write_errors_total[1h]) > 0"),
          for: "5m",
          labels: { severity: "critical" },
        },
      ],
    },

    // Temperature monitoring
    {
      name: "resource-temperature-monitoring",
      rules: [
        {
          alert: "HighCPUTemperature",
          annotations: {
            description: escapePrometheusTemplate(
              "CPU temperature on {{ $labels.instance }} is high: {{ $value }}°C (chip: {{ $labels.chip }})",
            ),
            summary: "High CPU temperature detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString('node_hwmon_temp_celsius{chip=~".*coretemp.*"} > 80'),
          for: "10m",
          labels: { severity: "warning" },
        },
        {
          alert: "CriticalCPUTemperature",
          annotations: {
            description: escapePrometheusTemplate(
              "CPU temperature on {{ $labels.instance }} is critical: {{ $value }}°C (chip: {{ $labels.chip }})",
            ),
            summary: "Critical CPU temperature detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString('node_hwmon_temp_celsius{chip=~".*coretemp.*"} > 90'),
          for: "5m",
          labels: { severity: "critical" },
        },
        {
          alert: "HighSystemTemperature",
          annotations: {
            description: escapePrometheusTemplate(
              "System temperature on {{ $labels.instance }} is high: {{ $value }}°C (sensor: {{ $labels.sensor }})",
            ),
            summary: "High system temperature detected",
          },
          // Raised threshold from 75°C to 85°C to reduce noise - 75°C is normal for many components under load
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("node_hwmon_temp_celsius > 85"),
          for: "15m",
          labels: { severity: "warning" },
        },
      ],
    },

    // Security and anomaly detection
    {
      name: "resource-security-monitoring",
      rules: [
        {
          alert: "UnusualProcessCount",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has unusual process count: {{ $value }} processes (significant deviation from normal)",
            ),
            summary: "Unusual process count detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "node_procs_running > 2 * avg_over_time(node_procs_running[7d])",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
        {
          alert: "HighContextSwitches",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has high context switches: {{ $value }}/s (potential malicious activity)",
            ),
            summary: "High context switches detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("rate(node_context_switches_total[5m]) > 500000"), // Increased from 100k - Kubernetes hosts normally have high context switches
          for: "30m",
          labels: { severity: "warning" },
        },
        {
          alert: "UnusualFileDescriptorUsage",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has unusual file descriptor usage: {{ $value }} open FDs",
            ),
            summary: "Unusual file descriptor usage",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("node_filefd_allocated > 0.8 * node_filefd_maximum"),
          for: "10m",
          labels: { severity: "warning" },
        },
        {
          alert: "SuspiciousNetworkConnections",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has suspicious network activity: {{ $value }} network errors in short time",
            ),
            summary: "Suspicious network connections detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(node_network_receive_errs_total[10m]) > 100 or increase(node_network_transmit_errs_total[10m]) > 100",
          ),
          for: "5m",
          labels: { severity: "warning" },
        },
        {
          alert: "UnusualSystemLoad",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has unusual system load: {{ $value }} (much higher than CPU count)",
            ),
            summary: "Unusual system load detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'node_load15 > 2 * count by (instance) (node_cpu_seconds_total{mode="idle"})',
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
        {
          alert: "PotentialCryptoMining",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} shows potential crypto mining activity: sustained high CPU with unusual network patterns",
            ),
            summary: "Potential crypto mining activity detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)) > 90 and rate(node_network_transmit_bytes_total[5m]) > 1048576', // High CPU + network activity
          ),
          for: "30m",
          labels: { severity: "critical" },
        },
      ],
    },

    // System health monitoring
    {
      name: "resource-system-health",
      rules: [
        {
          alert: "NodeExporterDown",
          annotations: {
            description: escapePrometheusTemplate(
              "Node exporter on {{ $labels.instance }} has been down for more than 5 minutes",
            ),
            summary: "Node exporter down",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString('up{job="node-exporter"} == 0'),
          for: "5m",
          labels: { severity: "critical" },
        },
        {
          alert: "SystemBootRecent",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has been rebooted recently: {{ $value | humanizeDuration }} ago",
            ),
            summary: "Recent system boot detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "time() - node_boot_time_seconds < 600", // Less than 10 minutes
          ),
          for: "1m",
          labels: { severity: "info" },
        },
        {
          alert: "ClockSkewDetected",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has clock skew: {{ $value }}s difference from Prometheus server",
            ),
            summary: "Clock skew detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'abs(node_time_seconds - timestamp(up{job="node-exporter"})) > 30',
          ),
          for: "5m",
          labels: { severity: "warning" },
        },
      ],
    },
  ];
}
