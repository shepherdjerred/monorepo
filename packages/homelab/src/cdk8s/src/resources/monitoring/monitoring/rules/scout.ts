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
          alert: "ScoutAiProviderIssueActive",
          annotations: {
            summary: escapePrometheusTemplate(
              "Scout AI provider {{ $labels.provider }} {{ $labels.kind }} issue active",
            ),
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} has an active AI provider issue from {{ $labels.source }} (provider={{ $labels.provider }}, kind={{ $labels.kind }}). Check provider billing/rate limits and Scout logs.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max by (environment, app, provider, kind, source) (ai_provider_issue_active{app="scout-for-lol"}) == 1',
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
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
    {
      name: "scout-scheduled-reports",
      rules: [
        {
          alert: "ScoutScheduledReportFailuresHigh",
          annotations: {
            summary: "Scout scheduled reports are failing",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} saw {{ $value | humanize }} scheduled report failure(s) in the last 30m from {{ $labels.system_source }} reports. Check Bugsink and the report run history before enabling more schedules.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum by (environment, system_source) (increase(scheduled_reports_failed_total[30m])) > 0",
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ScoutScheduledReportRuntimeHigh",
          annotations: {
            summary: "Scout scheduled reports are slow",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} scheduled report p95 runtime is {{ $value | humanize }}ms for {{ $labels.system_source }} reports. Check report row-scan metrics and SQLite import lag.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "histogram_quantile(0.95, sum by (environment, system_source, le) (rate(scheduled_reports_duration_ms_bucket[30m]))) > 30000",
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    {
      // Detects the failure mode that bit us 2026-06-14: the dispatcher
      // silently skipped 7 COMMON_DENOMINATOR reports for ~1 month because
      // syncSystemReports overwrote nextScheduledRunAt past the fire window
      // every minute. No `reports_failed_total` increment, no error log —
      // runReport was never called. The freshness gauge
      // `scout_scheduled_report_last_success_timestamp_seconds` (set on
      // SCHEDULED-trigger SUCCESS only, seeded from DB on startup) is the
      // only signal that catches that class of bug. Both alerts page
      // (severity=critical).
      name: "scout-scheduled-reports-stale",
      rules: [
        {
          alert: "ScoutScheduledReportMissedDaily",
          annotations: {
            summary: escapePrometheusTemplate(
              "Scout daily scheduled report {{ $labels.title }} has not fired",
            ),
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} report {{ $labels.title }} (id={{ $labels.report_id }}, source={{ $labels.system_source }}) has not successfully run on schedule for {{ $value | humanizeDuration }}. Expected daily.",
            ),
            runbook_url:
              "https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/reports/scheduler.ts",
          },
          // 25h = one day + 1h grace. system_source=COMPETITION uses 0 0 * * *.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(time() - scout_scheduled_report_last_success_timestamp_seconds{system_source="COMPETITION"}) > 90000',
          ),
          for: "10m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "ScoutScheduledReportMissedWeekly",
          annotations: {
            summary: escapePrometheusTemplate(
              "Scout weekly scheduled report {{ $labels.title }} has not fired",
            ),
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} report {{ $labels.title }} (id={{ $labels.report_id }}, source={{ $labels.system_source }}) has not successfully run on schedule for {{ $value | humanizeDuration }}. Expected weekly (Sunday).",
            ),
            runbook_url:
              "https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/reports/scheduler.ts",
          },
          // 8d1h grace. system_source=COMMON_DENOMINATOR uses 0 18 * * 0.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(time() - scout_scheduled_report_last_success_timestamp_seconds{system_source="COMMON_DENOMINATOR"}) > 698400',
          ),
          for: "10m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
  ];
}
