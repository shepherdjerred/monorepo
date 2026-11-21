import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";
import { transitionRendering } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import {
  SCOUT_TEMPORAL_WORKER_MISSING,
  SCOUT_WORKFLOW_ROUTING_UNKNOWN,
} from "./scout-worker-ownership.ts";

// Extracted from scout.ts (which is at the max-lines limit) to keep the
// "scout-temporal" rule group's definition alongside the rest of Scout's
// alert rules without exceeding the file-length ESLint cap.
export function getScoutTemporalRuleGroup(
  transition: boolean = transitionRendering(),
): PrometheusRuleSpecGroups {
  return {
    name: "scout-temporal",
    rules: [
      {
        alert: "ScoutTemporalDisconnected",
        annotations: {
          summary: "Scout Temporal supervisor is disconnected",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} has been disconnected from Temporal for over 5 minutes and is rejecting durable workflow starts. Check Temporal frontend health, network policies, and Scout pod logs to restore connectivity.",
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
          summary: "Scout Temporal task queue has no active worker",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} has no healthy worker polling the {{ $labels.queue_class }} queue class, stalling queued workflows or activities. Check the owning deployment pods and, for beta workflow tasks, verify current and ramped Worker Deployment builds.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          SCOUT_TEMPORAL_WORKER_MISSING,
        ),
        for: "5m",
        labels: { severity: "warning" },
      },
      {
        alert: "ScoutTemporalWorkflowRoutingUnknown",
        annotations: {
          summary: "Scout beta Temporal workflow routing is unavailable",
          description:
            "Scout beta cannot read fresh Temporal Worker Deployment routing metadata, leaving workflow poller ownership unverified. Check Temporal connectivity and the application pod's routing collector logs.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          SCOUT_WORKFLOW_ROUTING_UNKNOWN,
        ),
        for: "5m",
        labels: { severity: "warning" },
      },
      {
        alert: "ScoutTemporalActivityFailing",
        annotations: {
          summary: "Scout Temporal activities are failing",
          description: escapePrometheusTemplate(
            "Activity {{ $labels.activityType }} on queue {{ $labels.taskqueue }} in {{ $labels.exported_namespace }} has failed in the last 30 minutes, stalling dependent workflows. Inspect the workflow execution history and effect claims in Temporal before retrying manually.",
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
          summary: "Scout Temporal tasks are delayed waiting for workers",
          description: escapePrometheusTemplate(
            "Tasks on queue {{ $labels.taskqueue }} in {{ $labels.exported_namespace }} have a p95 schedule-to-start latency above 10 seconds, delaying durable background processing. Check worker pod health, CPU saturation, and poller capacity before adjusting concurrency.",
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
          description:
            "Scout cannot query report outbox, report delivery, or product projection state from PostgreSQL, leaving downstream staleness and delivery alerts blind. Check Scout database connectivity and the metric collector logs.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          '(scout_temporal_report_outbox_oldest_timestamp_seconds < 0) or (scout_temporal_stale_product_projections < 0) or (scout_report_delivery_unknown_chunks < 0) or absent(scout_temporal_report_outbox_oldest_timestamp_seconds{environment="beta"}) or absent(scout_temporal_report_outbox_oldest_timestamp_seconds{environment="prod"}) or absent(scout_temporal_stale_product_projections{environment="beta"}) or absent(scout_temporal_stale_product_projections{environment="prod"}) or absent(scout_report_delivery_unknown_chunks{environment="beta"}) or absent(scout_report_delivery_unknown_chunks{environment="prod"})',
        ),
        for: "5m",
        labels: { severity: "warning" },
      },
      {
        alert: "ScoutTemporalReportOutboxStale",
        annotations: {
          summary: "Scout report schedule outbox is stalled",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} has an unprocessed report schedule outbox entry older than 5 minutes, delaying schedule updates in Temporal. Check the singleton report schedule reconciler workflow and its Temporal schedule.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "scout_temporal_report_outbox_oldest_timestamp_seconds > 0 and (time() - scout_temporal_report_outbox_oldest_timestamp_seconds) > 300",
        ),
        for: "5m",
        labels: { severity: "warning" },
      },
      {
        alert: "ScoutProductAnnouncementFollowUpStale",
        annotations: {
          summary: "Scout delivered announcement bookkeeping is delayed",
          description:
            "A Scout Discord announcement was delivered over 5 minutes ago without completing product database bookkeeping, leaving follow-up state inconsistent. Check the notification-intent-expiry reconciliation activity and database health.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "scout_product_follow_up_oldest_timestamp_seconds > 0 and (time() - scout_product_follow_up_oldest_timestamp_seconds) > 300",
        ),
        for: "5m",
        labels: { severity: "warning" },
      },
      {
        alert: "ScoutProductDurabilityMetricsUnknown",
        annotations: {
          summary: "Scout product durability metrics are unavailable",
          description:
            "Scout cannot query product follow-up durability metrics from PostgreSQL, leaving announcement bookkeeping repair alerts blind. Check Scout database connectivity and the metric sweep logs.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          '(scout_product_follow_up_oldest_timestamp_seconds < 0) or absent(scout_product_follow_up_oldest_timestamp_seconds{environment="beta"}) or absent(scout_product_follow_up_oldest_timestamp_seconds{environment="prod"})',
        ),
        for: "5m",
        labels: { severity: "warning" },
      },
      {
        // Unknown ownership mismatches are deliberately not auto-deleted by the reconciler.
        alert: "ScoutTemporalReportScheduleDrift",
        annotations: {
          summary: "Scout Temporal report schedules have drifted",
          description:
            "The Scout report schedule audit detected missing, drifted, orphaned, or ownership-mismatched schedules between PostgreSQL and Temporal, so scheduled reports may miss runs or fire unexpectedly. Check the schedule audit logs and reconcile mismatched schedules.",
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
          summary: "Scout web query is stuck in running state",
          description:
            "An Explore or report-AI execution row has stayed active past its 40-minute budget, leaving the UI stuck in a running state. Check the corresponding Temporal workflow state and reconcile the product database row.",
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
          summary: "Scout AI provider attempt was interrupted mid-flight",
          description: escapePrometheusTemplate(
            transition
              ? "Scout {{ $labels.environment }} halted {{ $value }} interrupted {{ $labels.kind }} provider attempt(s) in the last 30 minutes instead of blindly retrying and risking duplicate model spend. Inspect persisted partial output and worker restart or eviction logs."
              : "Scout halted {{ $value }} interrupted {{ $labels.kind }} provider attempt(s) in the last 30 minutes instead of blindly retrying and risking duplicate model spend. Inspect persisted partial output and worker restart or eviction logs.",
          ),
        },
        // Under transition rendering the alert keeps the environment label, so
        // a Delivery monitor's `environment` matcher sees which Scout alarmed.
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          transition
            ? "sum by (environment, kind) (increase(scout_temporal_interrupted_provider_attempts_total[30m])) > 0"
            : "sum by (kind) (increase(scout_temporal_interrupted_provider_attempts_total[30m])) > 0",
        ),
        for: "1m",
        labels: { severity: "warning" },
      },
      {
        // The report path's counterpart of an intent held in
        // `unknown-delivery` (scout-durable-rules.ts): a send whose answer
        // never arrived, which nothing re-sends because a blind retry is how a
        // report posts twice.
        alert: "ScoutReportDeliveryUnknown",
        annotations: {
          summary: "Scout report delivery has uncertain Discord sends",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} holds {{ $value }} report delivery chunk(s) in UNKNOWN state because the Discord send response never arrived, and automatic retries are paused to avoid duplicate posts. Verify whether each message posted in Discord, then resolve the chunk in the operations console.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "max by (environment) (scout_report_delivery_unknown_chunks) > 0",
        ),
        for: "5m",
        labels: { severity: "warning" },
      },
    ],
  };
}
