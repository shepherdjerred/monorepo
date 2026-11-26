import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";
import {
  SCOUT_GATEWAY_OWNER_BY_STAGE,
  SCOUT_TRPC_NON_FAULT_CODES,
  scoutGatewayAlertRoleMatcher,
} from "./scout-alert-constants.ts";
import { getScoutClientRuleGroup } from "./scout/client-rules.ts";
import { getScoutDurableRuleGroup } from "./scout-durable-rules.ts";
import { getScoutTemporalRuleGroup } from "./scout-temporal-rules.ts";
import { getScoutMonitorDrillRuleGroups } from "./scout-monitor-drill.ts";

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

export function getScoutRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    getScoutTemporalRuleGroup(),
    getScoutDurableRuleGroup(),
    getScoutClientRuleGroup(),
    ...getScoutMonitorDrillRuleGroups(),
    {
      name: "scout-riot-api",
      rules: [
        {
          alert: "ScoutRiotApiErrorRateHigh",
          annotations: {
            summary: "Scout Riot API error rate is elevated",
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} is seeing {{ $value | humanize }} Riot API errors/min from {{ $labels.source }} (HTTP {{ $labels.http_status }}), which can delay match discovery and player lookups. Check Riot API status and Scout logs for failing endpoints or invalid requests.",
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
            summary: "Scout Riot API error rate is critically high",
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} is seeing {{ $value | humanize }} Riot API errors/min from {{ $labels.source }}, stalling match polling and report generation. Check Riot API status for an upstream outage and inspect Scout logs for failing routes.",
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
        {
          alert: "ScoutRiotApiAppRateLimitHigh",
          annotations: {
            summary: "Scout Riot API rate limit usage is elevated",
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} tracked traffic (everything but the participant crawl) is using {{ $value | humanizePercentage }} of its Riot app rate limit in the {{ $labels.window_seconds }}s window on route {{ $labels.route }}, leaving little headroom for bursts. Check polling concurrency and history backfill traffic on that route.",
            ),
          },
          // The crawl deliberately fills the window up to its utilisation
          // target, so only tracked usage (total minus the crawl's share,
          // reported by the pod the crawl runs in) means lost burst room.
          // Where no pod reports a crawl share, the total is tracked usage.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(max by (environment, route, window_seconds) (riot_api_app_rate_limit_count / riot_api_app_rate_limit_limit) - max by (environment, route, window_seconds) (riot_api_app_window_crawl_share_ratio) or max by (environment, route, window_seconds) (riot_api_app_rate_limit_count / riot_api_app_rate_limit_limit)) > 0.7",
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ScoutRiotApiAppRateLimitCritical",
          annotations: {
            summary: "Scout Riot API rate limit usage is critically high",
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} is using {{ $value | humanizePercentage }} of its Riot app rate limit in the {{ $labels.window_seconds }}s window on route {{ $labels.route }}: past the 90% every class but realtime stops at, so realtime is using its reserved band and 429s are close. Check active history imports and polling loops driving requests on that route.",
            ),
          },
          // Non-realtime classes stop at 0.90, but pods admit against counts
          // that lag each other's in-flight requests, so the short window can
          // read up to about 0.91 with no realtime at all (budget simulation,
          // `rate-budget.target.simulation.test.ts`). 0.92 means the realtime
          // band is in use.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "max by (environment, route, window_seconds) (riot_api_app_rate_limit_count / riot_api_app_rate_limit_limit) > 0.92",
          ),
          for: "5m",
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
              "Scout AI provider {{ $labels.provider }} has an issue",
            ),
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} is hitting a {{ $labels.kind }} issue with AI provider {{ $labels.provider }} ({{ $labels.source }}), degrading AI-generated match and report commentary. Check provider billing, quota limits, and Scout logs.",
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
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} failed {{ $value | humanize }} match-report renders in the last 30 minutes for queue {{ $labels.queue_type }}, dropping post-match Discord reports. Check Bugsink for rendering errors and verify whether the bundled Data Dragon snapshot is stale.",
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
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} logged {{ $value | humanize }} item-icon cache misses in the last 6 hours, rendering placeholder icons on match reports. Check the scout-data-dragon-version-check Temporal schedule to refresh bundled Data Dragon assets.",
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
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} had {{ $value | humanize }} scheduled {{ $labels.system_source }} report failure(s) in the last 30 minutes, leaving subscribed channels without scheduled summaries. Check Bugsink and report run history before enabling additional schedules.",
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
            summary: "Scout scheduled reports are running slow",
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} scheduled {{ $labels.system_source }} reports have a p95 runtime of {{ $value | humanize }}ms, risking timeouts and delayed Discord delivery. Check report query scan metrics and report-lake import lag.",
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
              "Scout daily scheduled report {{ $labels.title }} is overdue",
            ),
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} daily report {{ $labels.title }} (id={{ $labels.report_id }}, source={{ $labels.system_source }}) has not completed a scheduled run for {{ $value | humanizeDuration }}, leaving subscribers without daily standings. Check the report scheduler and Temporal schedule state.",
            ),
            runbook_url:
              "https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/reports/schedule/scheduler.ts",
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
              "Scout weekly scheduled report {{ $labels.title }} is overdue",
            ),
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} weekly report {{ $labels.title }} (id={{ $labels.report_id }}, source={{ $labels.system_source }}) has not completed a scheduled run for {{ $value | humanizeDuration }}, leaving subscribers without their weekly recap. Check the report scheduler and Temporal schedule state.",
            ),
            runbook_url:
              "https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/reports/schedule/scheduler.ts",
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
            description:
              "Scout production's bundled League season metadata expires in 3 to 14 days, after which season-based competition autocomplete will stop offering the current season. Review the scout-season-refresh-weekly PR and promote the resulting Scout release pair.",
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
            summary: "Scout production season metadata is expired or expiring",
            description:
              "Scout production's bundled League season metadata expires in under 3 days or has already expired, breaking season-based competition setup and autocomplete. Merge the season refresh PR and promote its Scout release pair immediately.",
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
          //
          // Scoped per stage to gateway-owning roles via SCOUT_GATEWAY_OWNER_BY_STAGE:
          // `discord_connection_status` is a plain prom-client gauge, so non-gateway
          // pods export a truthful 0 that would trip an unscoped `min by (environment)`.
          // The `absent()` half catches stages where no gateway owner pod is scheduled.
          alert: "ScoutDiscordDisconnected",
          annotations: {
            summary: "Scout is disconnected from Discord",
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} has no pod connected to the Discord gateway for over 5 minutes, so no match reports, updates, or slash commands are working. Check gateway pod health, logs, and Discord API status for that stage.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            SCOUT_GATEWAY_OWNER_BY_STAGE.flatMap(({ environment }) => {
              const roleMatcher = scoutGatewayAlertRoleMatcher();
              const selector = `discord_connection_status{environment="${environment}",${roleMatcher}}`;
              return [
                `(max by (environment) (${selector}) == 0)`,
                `absent(${selector})`,
              ];
            }).join(" or "),
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        // Background schedules use TemporalScheduledCurrentFailure and
        // TemporalScheduleHealthUnknown in ops-snapshot.ts. The retired cron
        // timestamp has no producers and its daily assumption excludes weekly
        // work; do not add a duplicate schedule failure alert here.
        {
          alert: "ScoutInitialHistoryImportStale",
          annotations: {
            summary: "Scout initial match history import is stalled",
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} has a first-run player history import stalled for over 6 hours, delaying baseline stats and historical reports for newly tracked players. Check import phase metrics, Riot HTTP 429 throttling, SeaweedFS storage, and report-lake folding.",
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
          // Individual blocked guilds are a USER problem (deleted channels or
          // revoked perms; the owner is DM'd via backed-off escalation), so
          // don't page on one or two. A spike across >5 guilds at once points
          // at a bot-side delivery bug instead.
          alert: "ScoutGuildDeliveryBlockedSpike",
          annotations: {
            summary: "Scout Discord delivery is blocked across multiple guilds",
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} cannot deliver messages to {{ $value }} Discord guilds simultaneously, indicating a likely bot-side delivery regression rather than isolated channel permission issues. Check Discord gateway permissions, bot send errors in Bugsink, and recent delivery changes.",
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
            summary: "Scout website is returning server errors",
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} returned {{ $value | humanize }} HTTP 5xx responses in 30 minutes on route {{ $labels.route }}, failing dashboard requests for users. Check Bugsink and Scout application pod logs for unhandled backend exceptions.",
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
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} failed {{ $value | humanize }} Discord user-guild lookups ({{ $labels.reason }}) in 30 minutes, preventing web users from viewing or managing their servers. Check Discord API status, outbound network connectivity, and Scout OAuth logs.",
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
            summary: "Scout API requests are failing",
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} tRPC procedure {{ $labels.procedure }} returned {{ $labels.code }} {{ $value | humanize }} times in 30 minutes, degrading web dashboard functionality. Check Bugsink and application logs for failures in {{ $labels.procedure }}.",
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
            description: escapePrometheusTemplate(
              "Scout {{ $labels.environment }} failed {{ $value | humanizePercentage }} of web sign-in attempts over the last 6 hours, blocking users from accessing the dashboard. Check Discord OAuth callback logs, redirect URI configuration, and database session writes.",
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
