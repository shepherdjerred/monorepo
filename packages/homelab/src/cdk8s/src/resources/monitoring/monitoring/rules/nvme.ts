import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

// Sustained 7-day write rate threshold for the regression alert. At 30 MB/s a 4 TB
// 990 PRO (2,400 TBW spec) burns through its TBW budget in ~2.5 years; well below
// expected service life. Catches the next CI scaling change before it eats the drives.
const WRITE_RATE_REGRESSION_BPS = 30 * 1024 * 1024;

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

        // Available spare capacity. Drops below 0.20 means firmware is running out of
        // reserved blocks for replacement; failure is approaching even before percentage_used hits 1.0.
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

        // Sustained write-rate regression. The 7-day window smooths past CI bursts
        // without masking a workload change. nvme1n1 hosts the ZFS pool so it carries
        // most of the load; nvme0n1 hosts /var (containerd) and writes less.
        {
          alert: "NvmeWriteRateRegression",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `avg_over_time(rate(node_disk_written_bytes_total{device=~"nvme.*"}[5m])[7d:5m]) > ${String(WRITE_RATE_REGRESSION_BPS)}`,
          ),
          for: "1h",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: escapePrometheusTemplate(
              "Sustained NVMe write rate above 30 MB/s on {{ $labels.device }}",
            ),
            description: escapePrometheusTemplate(
              "NVMe {{ $labels.device }} 7-day-avg write rate is {{ $value | humanize }}B/s. At sustained 30 MB/s a 4 TB Samsung 990 PRO (2,400 TBW) reaches spec TBW in ~2.5 years. Investigate the top dataset writers via `node_zfs_zpool_dataset_nwritten`.",
            ),
          },
        },
      ],
    },
  ];
}
