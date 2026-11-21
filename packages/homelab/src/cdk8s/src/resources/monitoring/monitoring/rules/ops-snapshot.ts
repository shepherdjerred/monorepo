import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

/**
 * Six missed 5-minute `ops-snapshot` runs. The dashboard already renders a
 * snapshot older than three intervals as `unknown`; this pages only once the
 * collector has been silent long enough to be broken rather than slow.
 */
export const OPS_SNAPSHOT_STALE_SECONDS = 1800;

/** One source failing every run for an hour, while the snapshot still ships. */
export const OPS_SNAPSHOT_SOURCE_STALE_SECONDS = 3600;

const SCHEDULE_LABELS = "temporal_namespace, schedule_id, workflow_type";
// Multiple infra pollers can hold gauges. Select the newest observation before
// reducing values, so an older failed gauge cannot mask a successful successor.
function currentScheduleGauge(metric: string): string {
  return `${metric} and on(namespace,pod,${SCHEDULE_LABELS}) (temporal_schedule_observation_timestamp_seconds == on(${SCHEDULE_LABELS}) group_left max by(${SCHEDULE_LABELS}) (temporal_schedule_observation_timestamp_seconds))`;
}

export function getOpsSnapshotRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "ops-snapshot-freshness",
      rules: [
        {
          alert: "OpsSnapshotStale",
          annotations: {
            summary: `Ops snapshot has not published in ${String(OPS_SNAPSHOT_STALE_SECONDS / 60)} minutes`,
            description: `No ops snapshot has been published to Hub for more than ${String(OPS_SNAPSHOT_STALE_SECONDS / 60)} minutes, causing the ops overview, TRMNL screen, and digests to show unknown state. Check the ops-snapshot schedule in the Temporal UI, the infra worker logs, and the Hub ingest endpoint.`,
          },
          // `absent` covers a collector that never published since the worker
          // started; `for` absorbs the first run after a worker restart.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(time() - max(ops_snapshot_published_timestamp_seconds) > ${String(OPS_SNAPSHOT_STALE_SECONDS)}) or absent(ops_snapshot_published_timestamp_seconds)`,
          ),
          for: "15m",
          labels: { severity: "warning", category: "ops" },
        },
        {
          alert: "OpsSnapshotSourceStale",
          annotations: {
            summary: escapePrometheusTemplate(
              "Ops snapshot source {{ $labels.source }} is stale",
            ),
            description: escapePrometheusTemplate(
              `Ops snapshot source {{ $labels.source }} has failed collection for over ${String(OPS_SNAPSHOT_SOURCE_STALE_SECONDS / 60)} minutes, leaving its dashboard sections in an unknown state. Inspect the ops-snapshot activity logs in the infra worker for {{ $labels.source }} errors.`,
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `time() - max by (source) (ops_snapshot_source_last_success_timestamp_seconds) > ${String(OPS_SNAPSHOT_SOURCE_STALE_SECONDS)}`,
          ),
          for: "10m",
          labels: { severity: "warning", category: "ops" },
        },
        {
          alert: "TemporalScheduledCurrentFailure",
          annotations: {
            summary: escapePrometheusTemplate(
              "Scheduled workflow {{ $labels.schedule_id }} failed its latest run",
            ),
            description: escapePrometheusTemplate(
              "The latest completed run of schedule {{ $labels.temporal_namespace }}/{{ $labels.schedule_id }} ({{ $labels.workflow_type }}) failed and has not yet succeeded on a subsequent run. Inspect the failed execution in the Temporal UI and the Ops maintenance dashboard.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(max by (${SCHEDULE_LABELS}) (${currentScheduleGauge("temporal_schedule_last_terminal_failed")}) == 1) and on(${SCHEDULE_LABELS}) (max by (${SCHEDULE_LABELS}) (temporal_schedule_observation_timestamp_seconds) > time() - 1800)`,
          ),
          for: "10m",
          labels: { severity: "warning", category: "ops" },
        },
        {
          alert: "TemporalScheduleHealthUnknown",
          annotations: {
            summary: escapePrometheusTemplate(
              "Scheduled workflow {{ $labels.schedule_id }} outcome is unknown",
            ),
            description: escapePrometheusTemplate(
              "Schedule {{ $labels.temporal_namespace }}/{{ $labels.schedule_id }} has incomplete or expired execution history, so the ops monitor cannot verify that its latest run succeeded. Check the schedule in the Temporal UI and trigger or inspect a fresh execution.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `max by (${SCHEDULE_LABELS}) (${currentScheduleGauge("temporal_schedule_health_unknown")}) == 1`,
          ),
          for: "30m",
          labels: { severity: "warning", category: "ops" },
        },
        {
          alert: "TemporalScheduleHealthObservationStale",
          annotations: {
            summary: "Temporal schedule health monitoring is stale",
            description:
              "Temporal schedule health observations are missing or over 30 minutes old, blinding alerts for failed scheduled workflows. Check the ops-snapshot workflow and the Temporal infra worker logs.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(time() - max by (${SCHEDULE_LABELS}) (temporal_schedule_observation_timestamp_seconds) > 1800) or absent(temporal_schedule_observation_timestamp_seconds)`,
          ),
          for: "10m",
          labels: { severity: "warning", category: "ops" },
        },
      ],
    },
  ];
}
