import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";
import { getSystemHealthRuleGroups } from "./resource-monitoring-system.ts";
import { getLiskovResourceMonitoringRuleGroups } from "./resource-monitoring-liskov.ts";
import { CI_NODE_HOSTNAME } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { getProductionResourceMonitoringRuleGroups } from "./resource-monitoring-production.ts";
import {
  memoryLeakExpression,
  pvcProjectedFullExpression,
} from "./resource-monitoring-expressions.ts";
import { getZfsPvcRuleGroup } from "./resource-monitoring-zfs.ts";
import { getPrometheusStorageForecastRuleGroup } from "./prometheus-storage-forecast.ts";

const NOT_CI_NODE = `node!="${CI_NODE_HOSTNAME}"`;
const CI_NODE_ONLY = `node="${CI_NODE_HOSTNAME}"`;

export function getResourceMonitoringRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "resource-cpu-monitoring",
      rules: [
        {
          alert: "HighCPUUsageSustained",
          annotations: {
            summary: "Node CPU usage has stayed above 75% for over 24 hours",
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has sustained {{ $value | humanize }}% CPU usage for more than 24 hours, leaving reduced headroom for bursts and rescheduling. Identify top CPU-consuming pods on the node and check for runaway loops or under-provisioned workloads.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle", ${NOT_CI_NODE}}[5m])) * 100)) > 75`,
          ),
          for: "1d",
          labels: { severity: "warning" },
        },
        {
          alert: "VeryHighCPUUsage",
          annotations: {
            summary: "Node CPU usage is above 80%",
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has been running at {{ $value | humanize }}% CPU for 15 minutes, risking CPU throttling and degraded latency for hosted services. Inspect top CPU pods on the node and throttle, scale back, or reschedule heavy workloads.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle", ${NOT_CI_NODE}}[5m])) * 100)) > 80`,
          ),
          for: "15m",
          labels: { severity: "critical" },
        },
      ],
    },

    {
      name: "resource-memory-monitoring",
      rules: [
        {
          alert: "HighMemoryPressure",
          annotations: {
            summary: "Node memory usage is above 90%",
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} is using {{ $value | humanizePercentage }} of total memory, leaving little headroom before kubelet eviction or OOM kills occur. Check top memory-consuming pods on the node and investigate unexpected growth or oversized workloads.",
            ),
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
            summary: "Node has less than 1 GiB of available memory",
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} is down to {{ $value | humanize1024 }}B of available memory, putting pods and system daemons at immediate risk of OOM kills. Inspect memory-heavy pods and recent OOM events on the node and shed or restart offending workloads.",
            ),
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
            summary: "Node non-ARC memory grew by over 8 GiB in 24 hours",
            description: escapePrometheusTemplate(
              "Non-ZFS-ARC memory usage on {{ $labels.instance }} has grown by {{ $value | humanize1024 }}B compared to 24 hours ago and stayed elevated for 4 hours, indicating a possible memory leak. Compare per-container working-set memory growth in Grafana to find the leaking pod or host process.",
            ),
          },
          // 8GB increase over 24h, excluding ZFS ARC cache.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            memoryLeakExpression,
          ),
          for: "4h",
          labels: { severity: "warning" },
        },
      ],
    },

    ...getProductionResourceMonitoringRuleGroups(),
    ...getLiskovResourceMonitoringRuleGroups(),
    getZfsPvcRuleGroup(),
    getPrometheusStorageForecastRuleGroup(),

    {
      name: "resource-network-monitoring",
      rules: [
        {
          alert: "HighNetworkTransmit",
          annotations: {
            summary:
              "Sustained network egress above 100 MiB/s on node interface",
            description: escapePrometheusTemplate(
              "Interface {{ $labels.device }} on {{ $labels.instance }} has transmitted {{ $value | humanize1024 }}B/s for over an hour, which may saturate link bandwidth or indicate unexpected data transfer. Check per-pod network egress metrics in Grafana to identify the source workload.",
            ),
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
            summary:
              "Sustained network ingress above 100 MiB/s on node interface",
            description: escapePrometheusTemplate(
              "Interface {{ $labels.device }} on {{ $labels.instance }} has received {{ $value | humanize1024 }}B/s for over an hour, which may saturate link capacity or reflect an unexpected download loop. Check per-pod network ingress metrics in Grafana to identify the receiving workload.",
            ),
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
            summary: "Sharp spike in node network egress rate",
            description: escapePrometheusTemplate(
              "Interface {{ $labels.device }} on {{ $labels.instance }} is transmitting {{ $value | humanize1024 }}B/s, more than 10x its 1-hour baseline for at least 10 minutes. Inspect active pods and recent network connections on the node to verify whether the spike is expected.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'rate(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[5m]) > 10 * rate(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[1h])',
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
      ],
    },

    {
      name: "resource-disk-monitoring",
      rules: [
        {
          alert: "PVCStorageHigh",
          annotations: {
            summary: "PVC storage usage is above 90%",
            description: escapePrometheusTemplate(
              "PersistentVolumeClaim {{ $labels.namespace }}/{{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full, risking write failures when capacity runs out. Prune unneeded data in the volume or increase the PVC storage request in cdk8s.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes) > 0.9",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
        {
          alert: "PVCProjectedFullWithin60Days",
          annotations: {
            summary: "PVC is projected to fill within 60 days",
            description: escapePrometheusTemplate(
              "PersistentVolumeClaim {{ $labels.namespace }}/{{ $labels.persistentvolumeclaim }} is projected to run out of space in roughly {{ $value | humanizeDuration }} based on its 7-day growth trend. Review data retention for the workload or plan a PVC capacity increase in cdk8s.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            pvcProjectedFullExpression(60),
          ),
          for: "6h",
          labels: { severity: "warning" },
        },
        {
          alert: "PVCProjectedFullWithin14Days",
          annotations: {
            summary: "PVC is projected to fill within 14 days",
            description: escapePrometheusTemplate(
              "PersistentVolumeClaim {{ $labels.namespace }}/{{ $labels.persistentvolumeclaim }} is projected to exhaust free space in roughly {{ $value | humanizeDuration }} based on its 7-day growth rate, risking imminent write failures. Reclaim space inside the volume or expand the PVC storage request promptly.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            pvcProjectedFullExpression(14),
          ),
          for: "6h",
          labels: { severity: "critical" },
        },
        {
          alert: "HighDiskUsage",
          annotations: {
            summary: "Node filesystem usage is above 85%",
            description: escapePrometheusTemplate(
              "Filesystem {{ $labels.mountpoint }} on {{ $labels.instance }} is {{ $value | humanizePercentage }} full, risking disk-pressure pod evictions or host write failures. Check image caches, logs, and local storage consumers on the node and reclaim space.",
            ),
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
            summary: "Sustained SSD write rate above 50 MiB/s",
            description: escapePrometheusTemplate(
              "SSD {{ $labels.device }} on {{ $labels.instance }} has sustained {{ $value | humanize1024 }}B/s of writes for 30 minutes, accelerating drive wear and competing for disk I/O. Identify write-heavy pods or host processes in Grafana and tune logging, caching, or checkpoint intervals.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `max by (instance, device) (rate(node_disk_written_bytes_total{${NOT_CI_NODE}}[5m])) > 52428800 and on (instance, device) node_disk_info{rotational="0",${NOT_CI_NODE}}`, // 50MB/s, SSD only
          ),
          for: "30m",
          labels: { severity: "warning" },
        },
        {
          alert: "SustainedDiskWriteActivity",
          annotations: {
            summary: "SSD wrote more than 1 TiB in the last 24 hours",
            description: escapePrometheusTemplate(
              "SSD {{ $labels.device }} on {{ $labels.instance }} has written {{ $value | humanize1024 }}B over the past 24 hours, accelerating NVMe endurance wear. Inspect per-pod disk write metrics to find and curb excessive write amplification or runaway jobs.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `increase(max by (instance, device) (node_disk_written_bytes_total{${NOT_CI_NODE}})[24h:5m]) > 1024^4 and on (instance, device) node_disk_info{rotational="0",${NOT_CI_NODE}}`, // > 1 TiB/day, SSD only
          ),
          for: "1h",
          labels: { severity: "warning" },
        },
        {
          alert: "DiskIOUtilizationHigh",
          annotations: {
            summary: "Disk I/O utilization is above 80%",
            description: escapePrometheusTemplate(
              "Disk {{ $labels.device }} on {{ $labels.instance }} has been busy {{ $value | humanizePercentage }} of the time for 15 minutes, which can stall storage-backed workloads and database latency. Check node I/O wait and per-pod disk throughput in Grafana to isolate the contending workload.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(node_disk_io_time_seconds_total[5m]) > 0.8",
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
        // Device read/write errors are not node-exporter metrics. Media errors
        // alert from the NVMe and SMART rule groups instead.
      ],
    },

    getTemperatureRuleGroup(),

    // Security and anomaly detection
    {
      name: "resource-security-monitoring",
      rules: [
        // No runnable-process-count anomaly rule: node_procs_running on the
        // bursty 32-thread CI node routinely doubles its seven-day mean, so a
        // ratio against it carried no security signal. Load is covered by
        // UnusualSystemLoad and CriticalSystemLoad below.
        {
          alert: "HighContextSwitches",
          annotations: {
            summary: "Node context-switch rate is unusually high",
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has sustained {{ $value | humanize }} context switches/s for 30 minutes, wasting CPU on scheduler overhead and signaling possible spin loops or abnormal workload behavior. Inspect pod CPU throttling, thread counts, and top active processes on the node.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(node_context_switches_total[5m]) > 500000",
          ), // Increased from 100k - Kubernetes hosts normally have high context switches
          for: "30m",
          labels: { severity: "warning" },
        },
        {
          alert: "UnusualFileDescriptorUsage",
          annotations: {
            summary: "Node open file descriptors exceed 80% of kernel limit",
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has {{ $value | humanize }} allocated file descriptors (over 80% of its kernel maximum), risking socket and file-open failures across all pods on the host. Identify pods leaking sockets or file handles and restart or fix the offending service.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "node_filefd_allocated > 0.8 * node_filefd_maximum",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
        {
          alert: "SuspiciousNetworkConnections",
          annotations: {
            summary: "High network interface error rate on node",
            description: escapePrometheusTemplate(
              "Interface {{ $labels.device }} on {{ $labels.instance }} recorded {{ $value | humanize }} network packet errors in 10 minutes, degrading connectivity and causing retransmits. Check link status, NIC driver logs, cabling, or abnormal traffic patterns on the node.",
            ),
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
            summary:
              "Node 15-minute load average exceeds twice CPU thread count",
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has a 15-minute load average of {{ $value | humanize }}, more than twice its CPU thread count, indicating sustained CPU or uninterruptible I/O contention. Check CPU saturation, disk I/O stalls, and runnable or D-state tasks on the node.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'node_load15 > 2 * count by (instance) (node_cpu_seconds_total{mode="idle"})',
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
        // 2026-07 CI-freeze hardening: UnusualSystemLoad above (node_load15,
        // 15m `for:`) is too slow to catch the ramp pattern that preceded
        // every 2026-07 kernel hard-lockup freeze — the worst observed ramp
        // went from load=5 to load=1300 in under 8 minutes. node_load1 reacts
        // fast enough to give real lead time before the kernel scheduler locks
        // up. Threshold (8x core count = load1 > 256 on this 32-thread node)
        // sits well above legitimate heavy-CI peaks (CPU% maxed ~93% during
        // past healthy heavy bursts, not multiples of thread count) and well
        // below the catastrophic range actually observed.
        {
          alert: "CriticalSystemLoad",
          annotations: {
            summary:
              "Node 1-minute load is critically high — imminent lockup risk",
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has a 1-minute load average of {{ $value | humanize }} (over 8x its CPU thread count), risking an imminent kernel scheduler lockup where kubectl and talosctl stop responding. Cancel in-flight Woodpecker builds or shed runaway workloads on the node immediately.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'node_load1 > 8 * count by (instance) (node_cpu_seconds_total{mode="idle"})',
          ),
          for: "2m",
          labels: { severity: "critical" },
        },
        {
          alert: "PotentialCryptoMining",
          annotations: {
            summary: "Potential crypto-mining activity detected on node",
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has sustained over 90% CPU usage ({{ $value | humanize }}%) alongside more than 1 MiB/s of network egress for 30 minutes, matching unauthorized compute or crypto-mining behavior. Audit running containers, recent deployments, and outbound connections on the node immediately.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            // Non-CI nodes: any sustained high CPU + egress is suspicious. The
            // CI node is excluded here (it runs hot by design) and covered by
            // the CI-node-specific rule below instead — it is NOT unmonitored.
            `(100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle", ${NOT_CI_NODE}}[5m])) * 100)) > 90 and sum by (instance) (rate(node_network_transmit_bytes_total{${NOT_CI_NODE}}[5m])) > 1048576`,
          ),
          for: "30m",
          labels: { severity: "critical" },
        },
        {
          // Security: the CI node is excluded from the generic rule above
          // because legitimate CI pins its CPU hot, but excluding it entirely
          // would let a compromised Woodpecker step mine undetected. Keep the
          // same compound CPU + egress signal active even while a job runs:
          // job presence is attacker-controlled and cannot be an exemption.
          alert: "PotentialCryptoMiningCiNode",
          annotations: {
            summary: "Potential crypto-mining activity on CI node",
            description: escapePrometheusTemplate(
              "CI node {{ $labels.instance }} has sustained over 90% CPU usage ({{ $value | humanize }}%) with more than 1 MiB/s of network egress for 30 minutes, which can indicate a compromised CI pipeline step. Inspect active Woodpecker builds, container processes, and outbound network destinations immediately.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle", ${CI_NODE_ONLY}}[5m])) * 100)) > 90 and sum by (instance) (rate(node_network_transmit_bytes_total{${CI_NODE_ONLY}}[5m])) > 1048576`,
          ),
          for: "30m",
          labels: { severity: "critical" },
        },
      ],
    },

    ...getSystemHealthRuleGroups(),
  ];
}

function getTemperatureRuleGroup(): PrometheusRuleSpecGroups {
  return {
    name: "resource-temperature-monitoring",
    rules: [
      {
        alert: "HighCPUTemperature",
        annotations: {
          summary: "CPU temperature is above 80°C",
          description: escapePrometheusTemplate(
            "CPU sensor {{ $labels.chip }} on {{ $labels.instance }} has been at {{ $value | humanize }}°C for 10 minutes, risking thermal throttling under sustained load. Check ambient cooling, fan speeds, heatsink airflow, and heavy CPU workloads on the host.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'node_hwmon_temp_celsius{chip=~".*coretemp.*"} > 80',
        ),
        for: "10m",
        labels: { severity: "warning" },
      },
      {
        alert: "CriticalCPUTemperature",
        annotations: {
          summary: "CPU temperature is critically high (above 90°C)",
          description: escapePrometheusTemplate(
            "CPU sensor {{ $labels.chip }} on {{ $labels.instance }} has reached {{ $value | humanize }}°C for 5 minutes, risking severe thermal throttling or emergency hardware shutdown. Shed CPU-intensive workloads immediately and inspect physical cooling and fans on the host.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'node_hwmon_temp_celsius{chip=~".*coretemp.*"} > 90',
        ),
        for: "5m",
        labels: { severity: "critical" },
      },
      {
        // AMD (liskov, Ryzen 9950X): the k10temp hwmon chip label is a bare
        // PCI address (e.g. "pci0000:00_0000:00:18_3"), NOT the string
        // "k10temp", so the coretemp-style regex above can never match it.
        // Join through node_hwmon_chip_names to select by chip_name instead.
        // Thresholds: Zen 5 Tctl TjMax is 95°C and Ryzen deliberately boosts
        // toward it, so warn only on sustained 90+ and page at 94+.
        alert: "HighCPUTemperatureAmd",
        annotations: {
          summary: "AMD CPU temperature is above 90°C",
          description: escapePrometheusTemplate(
            "AMD CPU sensor {{ $labels.chip }} on {{ $labels.instance }} has stayed at {{ $value | humanize }}°C for 15 minutes, approaching its 95°C thermal ceiling. Verify chassis airflow and CPU cooler performance and check whether sustained heavy builds are saturating the host.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'node_hwmon_temp_celsius * on (chip, instance) group_left(chip_name) node_hwmon_chip_names{chip_name=~".*k10temp.*"} > 90',
        ),
        for: "15m",
        labels: { severity: "warning" },
      },
      {
        alert: "CriticalCPUTemperatureAmd",
        annotations: {
          summary: "AMD CPU temperature is critically high (above 94°C)",
          description: escapePrometheusTemplate(
            "AMD CPU sensor {{ $labels.chip }} on {{ $labels.instance }} has stayed at {{ $value | humanize }}°C for 5 minutes, right at its thermal throttling limit and risking a hardware protection trip. Cancel heavy compute jobs on the host immediately and check cooler mounting, pump or fan operation, and airflow.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'node_hwmon_temp_celsius * on (chip, instance) group_left(chip_name) node_hwmon_chip_names{chip_name=~".*k10temp.*"} > 94',
        ),
        for: "5m",
        labels: { severity: "critical" },
      },
      {
        alert: "HighSystemTemperature",
        annotations: {
          summary: "Host hardware sensor temperature is above 85°C",
          description: escapePrometheusTemplate(
            "Hardware sensor {{ $labels.chip }}/{{ $labels.sensor }} on {{ $labels.instance }} has reported {{ $value | humanize }}°C for 15 minutes, risking component throttling or premature hardware wear. Inspect host cooling, enclosure airflow, and workload heat generation.",
          ),
        },
        // Raised threshold from 75°C to 85°C to reduce noise - 75°C is normal for many components under load.
        // k10temp sensors are excluded: Ryzen boosts Tctl toward its 95°C
        // TjMax by design, so 85°C+ is normal there — the dedicated
        // *CPUTemperatureAmd rules above cover those sensors instead.
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          '(node_hwmon_temp_celsius unless on (chip, instance) node_hwmon_chip_names{chip_name=~".*k10temp.*"}) > 85',
        ),
        for: "15m",
        labels: { severity: "warning" },
      },
    ],
  };
}
