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
            summary: "Ops snapshot is stale",
            description: escapePrometheusTemplate(
              `No ops snapshot has been published to the ops dashboard for more than ${String(OPS_SNAPSHOT_STALE_SECONDS / 60)} minutes, or the publish gauge is missing. The ops overview, TRMNL homelab screen, and digests are rendering unknown. Check the Temporal ops-snapshot schedule, the infra worker, and the dashboard ingest endpoint.`,
            ),
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
              `The ops snapshot has not collected {{ $labels.source }} successfully for more than ${String(OPS_SNAPSHOT_SOURCE_STALE_SECONDS / 60)} minutes. Its sections render unknown. Check the ops-snapshot activity error for that source.`,
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
              "Scheduled workflow {{ $labels.temporal_namespace }}/{{ $labels.schedule_id }} has not recovered",
            ),
            description:
              "The latest terminal scheduled action failed. A later running action does not clear it; a later completed scheduled action does. Check the Schedule in Temporal and the Ops maintenance section.",
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
            summary: "Scheduled workflow outcome evidence is unavailable",
            description:
              "One or more scheduled workflows has incomplete or expired execution evidence. The Ops maintenance section identifies the affected Schedule; no successful recovery is inferred.",
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
            summary: "Temporal Schedule health collection is stale",
            description:
              "Schedule inventory/outcome observations are more than 30 minutes old or missing. Check collectOpsTemporal and the infra worker; current schedule health cannot be established.",
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
