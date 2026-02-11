import { PrometheusRuleSpecGroups } from "../../../../../generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "../../../../../generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared";

export function getR2StorageRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "r2-storage",
      rules: [
        {
          alert: "R2StorageNearingLimit",
          annotations: {
            summary: "R2 storage approaching 1TB limit",
            message: escapePrometheusTemplate(
              "R2 bucket {{ $labels.bucket }} is at {{ $value | humanize1024 }}B (80% of 1TB limit)",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("cloudflare_r2_storage_bytes > 800 * 1024 * 1024 * 1024"),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "R2StorageExceedingLimit",
          annotations: {
            summary: "R2 storage exceeding 1TB limit",
            message: escapePrometheusTemplate(
              "R2 bucket {{ $labels.bucket }} has exceeded 1TB: {{ $value | humanize1024 }}B",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("cloudflare_r2_storage_bytes > 1024 * 1024 * 1024 * 1024"),
          for: "15m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "R2ExporterDown",
          annotations: {
            summary: "R2 exporter is not scraping successfully",
            message: escapePrometheusTemplate(
              "R2 exporter has not successfully scraped bucket {{ $labels.bucket }} metrics",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("cloudflare_r2_exporter_scrape_success == 0"),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
