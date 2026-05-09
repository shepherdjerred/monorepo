import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getScoutRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "scout-riot-api",
      rules: [
        {
          alert: "ScoutRiotApiErrorRateHigh",
          annotations: {
            summary: "Riot API error rate is elevated",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} is seeing {{ $value | humanize }} Riot API errors/min from source {{ $labels.source }} (status {{ $labels.http_status }}).",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum by (environment, source, http_status) (rate(riot_api_errors_total[15m])) * 60 > 2",
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ScoutRiotApiErrorRateCritical",
          annotations: {
            summary: "Riot API error rate is critically high",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} is seeing {{ $value | humanize }} Riot API errors/min from source {{ $labels.source }}. Riot API may be experiencing an outage.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum by (environment, source) (rate(riot_api_errors_total[15m])) * 60 > 10",
          ),
          for: "15m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
    {
      name: "scout-postmatch-reports",
      rules: [
        {
          // Postmatch report rendering is the last step before posting to
          // Discord; failures silently advance the polling cursor and
          // permanently lose the match. Catching a sustained failure rate
          // gives early warning before a Riot patch silences scout entirely.
          // This was missed for ~2 weeks in May 2026 because no alert
          // existed on this metric.
          alert: "ScoutMatchReportFailuresHigh",
          annotations: {
            summary: "Scout match-report rendering is failing",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} saw {{ $value | humanize }} match-report renders fail in the last 30m (queue {{ $labels.queue_type }}). Check Bugsink for the underlying error. Common cause: stale Data Dragon snapshot triggering a satori image-source error.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum by (environment, queue_type) (increase(reports_failed_total[30m])) > 3",
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
        {
          // Item icon cache misses fall back to a placeholder rather
          // than throwing, but a sustained rate is direct evidence the
          // bundled Data Dragon snapshot is behind the live patch.
          // Mirrors the prematch_loading_screen_skin_fallback alerting
          // pattern (informational, not paging).
          alert: "ScoutItemCacheMissesSustained",
          annotations: {
            summary: "Scout Data Dragon assets may be stale",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} saw {{ $value | humanize }} item-icon cache misses in the last 6h (rendered as placeholder). Refresh Data Dragon by checking the scout-data-dragon-version-check Temporal schedule.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum by (environment) (increase(scout_item_cache_miss_total[6h])) > 10",
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
