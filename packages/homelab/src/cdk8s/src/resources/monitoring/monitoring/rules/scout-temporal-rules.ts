import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

// Extracted from scout.ts (which is at the max-lines limit) to keep the
// "scout-temporal" rule group's definition alongside the rest of Scout's
// alert rules without exceeding the file-length ESLint cap.
export function getScoutTemporalRuleGroup(): PrometheusRuleSpecGroups {
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
            "Scout {{ $labels.exported_namespace }} queue {{ $labels.taskqueue }} Activity {{ $labels.activityType }} has failed in the last 30 minutes. Inspect the Workflow history and effect claims before retrying manually.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'sum by (exported_namespace, taskqueue, activityType) (increase(activity_task_fail{exported_namespace=~"beta|prod", taskqueue=~"scout(_.*)?"}[30m])) > 0',
        ),
        for: "10m",
        labels: { severity: "warning" },
      },
      {
        alert: "ScoutTemporalTaskScheduleToStartHigh",
        annotations: {
          summary: "Scout Temporal tasks are waiting for a Worker",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.exported_namespace }} queue {{ $labels.taskqueue }} task p95 schedule-to-start latency has exceeded ten seconds. Inspect the affected Worker before tuning concurrency.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'histogram_quantile(0.95, sum by (exported_namespace, taskqueue, le) (rate(task_schedule_to_start_latency_bucket{exported_namespace=~"beta|prod", taskqueue=~"scout(_.*)?"}[5m]))) > 10',
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
