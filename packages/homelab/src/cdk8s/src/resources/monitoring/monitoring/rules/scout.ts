import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";
import { SCOUT_TRPC_NON_FAULT_CODES } from "./scout-alert-constants.ts";

/**
 * tRPC result codes that are ordinary traffic on a public web surface rather
 * than backend faults: anonymous page loads, permission denials, bad client
 * input, and missing rows. Alerting on these would fire continuously.
 */
/**
 * Threshold note for the `scout-web` group.
 *
 * Scout's web surface is LOW VOLUME — roughly 21 sign-ins and ~90 anonymous app
 * loads per month in production. Per-second rate thresholds borrowed from
 * high-traffic services are therefore unreachable: `rate(...) > 0.05` needs ~45
 * events inside the window, so a total outage would pass unnoticed by the very
 * alert meant to catch it. These rules use absolute counts over a window
 * instead, sized to what "obviously wrong" looks like at this scale.
 */
function getScoutTemporalRuleGroup(): PrometheusRuleSpecGroups {
  return {
    name: "scout-temporal",
    rules: [
      {
        alert: "ScoutTemporalDisconnected",
        annotations: {
          summary: "Scout's embedded Temporal supervisor is disconnected",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} has rejected durable starts because its Temporal supervisor has been disconnected for five minutes. Legacy execution must remain stopped; restore Temporal connectivity.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          '(min by (environment) (scout_temporal_connected{environment=~"beta|prod"}) == 0) or absent(scout_temporal_connected{environment="beta"}) or absent(scout_temporal_connected{environment="prod"})',
        ),
        for: "5m",
        labels: { severity: "critical" },
      },
      {
        alert: "ScoutTemporalWorkerMissing",
        annotations: {
          summary: "A Scout Temporal task-queue worker is missing",
          message:
            "Scout must expose workflow, realtime, interactive, background, and lake Workers after Discord readiness. Inspect the embedded Worker supervisor before changing concurrency.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          '(count by (environment) (scout_temporal_workers{environment=~"beta|prod"} == 1) < 5) or absent(scout_temporal_workers{environment="beta"}) or absent(scout_temporal_workers{environment="prod"})',
        ),
        for: "5m",
        labels: { severity: "warning" },
      },
      {
        alert: "ScoutTemporalActivityFailing",
        annotations: {
          summary: "Scout Temporal Activities are failing",
          message: escapePrometheusTemplate(
            "Scout queue {{ $labels.task_queue }} has failed Activities in the last 30 minutes. Inspect the Workflow history and effect claims before retrying manually.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'sum by (task_queue) (increase(activity_task_fail{task_queue=~"scout-(beta|prod).*"}[30m])) > 0',
        ),
        for: "10m",
        labels: { severity: "warning" },
      },
      {
        alert: "ScoutTemporalTaskScheduleToStartHigh",
        annotations: {
          summary: "Scout Temporal tasks are waiting for a Worker",
          message:
            "Scout task p95 schedule-to-start latency has exceeded ten seconds. Inspect the affected task queue and embedded Worker resources before tuning concurrency.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'histogram_quantile(0.95, sum by (task_queue, le) (rate(task_schedule_to_start_latency_bucket{task_queue=~"scout-(beta|prod).*"}[5m]))) > 10000',
        ),
        for: "5m",
        labels: { severity: "warning" },
      },
      {
        alert: "ScoutTemporalDurabilityMetricsUnknown",
        annotations: {
          summary: "Scout Temporal durability metrics are unavailable",
          message:
            "Scout could not query report outbox or interactive projection state. Restore the Scout database metric query before relying on the age and drift alerts.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          '(scout_temporal_report_outbox_oldest_timestamp_seconds < 0) or (scout_temporal_stale_product_projections < 0) or absent(scout_temporal_report_outbox_oldest_timestamp_seconds{environment="beta"}) or absent(scout_temporal_report_outbox_oldest_timestamp_seconds{environment="prod"}) or absent(scout_temporal_stale_product_projections{environment="beta"}) or absent(scout_temporal_stale_product_projections{environment="prod"})',
        ),
        for: "5m",
        labels: { severity: "warning" },
      },
      {
        alert: "ScoutTemporalReportOutboxStale",
        annotations: {
          summary: "Scout's report Schedule outbox is stale",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} has an unprocessed report Schedule outbox row older than five minutes. Inspect the singleton reconciler Workflow and Temporal Schedule.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "scout_temporal_report_outbox_oldest_timestamp_seconds > 0 and (time() - scout_temporal_report_outbox_oldest_timestamp_seconds) > 300",
        ),
        for: "5m",
        labels: { severity: "warning" },
      },
      {
        alert: "ScoutTemporalReportScheduleDrift",
        annotations: {
          summary: "Scout report Schedules differ from product state",
          message:
            "The report Schedule audit found a missing, drifted, orphaned, or ownership-mismatched Schedule. Unknown ownership mismatches are deliberately not deleted.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "scout_temporal_report_schedule_drift > 0 or scout_temporal_report_schedule_orphans > 0",
        ),
        for: "5m",
        labels: { severity: "warning" },
      },
      {
        alert: "ScoutTemporalProductProjectionStale",
        annotations: {
          summary: "Scout product execution state is stale",
          message:
            "An Explore or report-AI projection has remained active beyond its 40-minute execution budget. Temporal remains authoritative; reconcile the product row from Workflow state.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "scout_temporal_stale_product_projections > 0",
        ),
        for: "5m",
        labels: { severity: "warning" },
      },
      {
        alert: "ScoutTemporalProviderAttemptInterrupted",
        annotations: {
          summary: "Scout salvaged an ambiguous provider attempt",
          message: escapePrometheusTemplate(
            "Scout interrupted {{ $value }} {{ $labels.kind }} provider attempt(s) rather than risk duplicate model spend. Inspect persisted partial output and the original Worker interruption.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "sum by (kind) (increase(scout_temporal_interrupted_provider_attempts_total[30m])) > 0",
        ),
        for: "1m",
        labels: { severity: "warning" },
      },
      {
        alert: "ScoutTemporalDuplicateEffectClaim",
        annotations: {
          summary: "Scout retried an ambiguous or mismatched external effect",
          message: escapePrometheusTemplate(
            "Scout observed {{ $value }} duplicate {{ $labels.kind }} effect claim(s) with outcome {{ $labels.outcome }}. Verify the stable Discord nonce or storage key prevented a duplicate effect.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'sum by (kind, outcome) (increase(scout_temporal_duplicate_effect_claims_total{outcome=~"ambiguous_retry|kind_mismatch"}[30m])) > 0',
        ),
        for: "1m",
        labels: { severity: "warning" },
      },
    ],
  };
}

export function getScoutRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    getScoutTemporalRuleGroup(),
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
          // 8d2h grace. system_source=COMMON_DENOMINATOR uses 0 18 * * 0.
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
    {
      name: "scout-bot-health",
      rules: [
        {
          alert: "ScoutSeasonScheduleExpiring",
          annotations: {
            summary: "Scout production season metadata expires soon",
            message:
              "Scout production's latest bundled League season ends in 3–14 days. Review the scout-season-refresh-weekly PR and promote the resulting minted Scout release pair before autocomplete expires.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(max by (environment) (scout_season_schedule_end_timestamp_seconds{environment="prod"}) - time() < 1209600) and (max by (environment) (scout_season_schedule_end_timestamp_seconds{environment="prod"}) - time() >= 259200)',
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ScoutSeasonScheduleCritical",
          annotations: {
            summary: "Scout production season metadata is critical",
            message:
              "Scout production's latest bundled League season ends in under 3 days or has expired. Merge the season refresh and promote its complete Scout release pair immediately; fixed-date competitions and other backend features remain available.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max by (environment) (scout_season_schedule_end_timestamp_seconds{environment="prod"}) - time() < 259200',
          ),
          for: "30m",
          labels: {
            severity: "critical",
          },
        },
        {
          // Whole-bot outage: if Scout drops off Discord nothing posts at all.
          // Previously only caught indirectly (and slowly) by the report-missed
          // alert; this pages within minutes.
          alert: "ScoutDiscordDisconnected",
          annotations: {
            summary: "Scout is disconnected from Discord",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} has been disconnected from the Discord gateway for >5m. No reports, match updates, or competitions are posting. Check the pod and Discord status.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "min by (environment) (discord_connection_status) == 0",
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          // A cron task (polling, dispatch, outreach, cleanup) that stops
          // succeeding entirely produces nothing and throws nothing. The
          // per-job last-success timestamp is the only signal. 25h backstop —
          // every scout cron runs at least daily, so a 25h gap means stalled.
          alert: "ScoutCronJobStale",
          annotations: {
            summary: escapePrometheusTemplate(
              "Scout cron job {{ $labels.job_name }} is stalled",
            ),
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} cron job {{ $labels.job_name }} has not succeeded in {{ $value | humanizeDuration }}. It may have stopped running (deadlock, unhandled rejection, or scheduler death).",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(time() - max by (environment, job_name) (cron_job_last_success_timestamp)) > 90000",
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ScoutInitialHistoryImportStale",
          annotations: {
            summary: "Scout initial match history import is stalled",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} has an actionable first-run history import older than six hours. Check the import phase metrics, Riot 429s, SeaweedFS, and report-lake folding.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "scout_initial_history_import_oldest_actionable_timestamp_seconds > 0 and (time() - scout_initial_history_import_oldest_actionable_timestamp_seconds) > 21600",
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          // Individual blocked guilds are a USER problem (the owner is DM'd via
          // the backed-off escalation), so don't page on one or two. A spike in
          // blocked guilds at once instead points at a bot-side delivery bug.
          alert: "ScoutGuildDeliveryBlockedSpike",
          annotations: {
            summary: "Many Scout guilds can't be delivered to",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} has {{ $value }} guilds where delivery is currently blocked. A handful is normal (deleted channels / revoked perms, owners are notified), but a spike suggests a bot-side delivery problem.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "max by (environment) (guild_send_blocked_total) > 5",
          ),
          for: "2h",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    {
      name: "scout-web",
      rules: [
        {
          alert: "ScoutWeb5xxRateHigh",
          annotations: {
            summary: "Scout web backend is returning server errors",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} is serving {{ $value | humanize }} 5xx responses in 30m on route {{ $labels.route }}. These are backend faults, not client mistakes.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum by (environment, route) (increase(scout_http_requests_total{status_class="5xx"}[30m])) > 5',
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          // The failure class that used to reach users as "You are not a member
          // of that guild" during a plain Discord outage. token_refresh_failed
          // is excluded: that one genuinely means the user must sign in again.
          alert: "ScoutDiscordUpstreamFailures",
          annotations: {
            summary: "Scout cannot reach Discord to resolve user guilds",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} is failing to fetch user guilds from Discord ({{ $labels.reason }}) saw {{ $value | humanize }} failures in 30m. Web users will see 'Couldn't reach Discord' and cannot manage their servers.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum by (environment, reason) (increase(scout_discord_user_guilds_failures_total{reason!="token_refresh_failed"}[30m])) > 3',
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          // UNAUTHORIZED/FORBIDDEN are excluded deliberately: anonymous page
          // loads and permission denials are ordinary traffic on a public web
          // surface, and alerting on them would fire constantly.
          alert: "ScoutTrpcErrorRateHigh",
          annotations: {
            summary: "Scout tRPC procedures are failing",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} procedure {{ $labels.procedure }} returned {{ $labels.code }} {{ $value | humanize }} times in 30m.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum by (environment, procedure, code) (increase(scout_trpc_calls_total{code!~"${SCOUT_TRPC_NON_FAULT_CODES.join("|")}"}[30m])) > 5`,
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          // Only meaningful once people are actually trying: the ratio is
          // guarded by a minimum attempt rate so a single failed sign-in on a
          // quiet night doesn't page.
          alert: "ScoutWebSigninFailureRate",
          annotations: {
            summary: "Scout web sign-ins are failing",
            message: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} sign-in failures are {{ $value | humanizePercentage }} of attempts over the last 6h. Users cannot get into the dashboard.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum by (environment) (increase(scout_web_signin_total{result=~"failed|callback_error"}[6h])) / sum by (environment) (increase(scout_web_signin_total{result="started"}[6h])) > 0.5 and sum by (environment) (increase(scout_web_signin_total{result="started"}[6h])) >= 3',
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
