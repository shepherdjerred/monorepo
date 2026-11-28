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

/**
 * Six consecutive 5-minute `main-ci` signal posts to Hub's Incidents module
 * failed, so a red `main` would not open an incident.
 */
export const INCIDENTS_SIGNAL_FAILING_FOR = "30m";

const SCHEDULE_LABELS = "temporal_namespace, schedule_id, workflow_type";
const SCHEDULE_IDENTITY_LABELS = "temporal_namespace, schedule_id";
const SCHEDULE_LOOKBACK = "20m";

// Multiple infra pollers can hold gauges, and single-replica rollouts briefly
// leave no live series past Prometheus's 5m staleness window. Select the newest
// observation across `[20m]` before reducing values, so rollouts never flap the
// series and an older failed pod cannot mask a newer successful successor.
function currentScheduleGauge(metric: string): string {
  return `${metric} and on(namespace,pod,${SCHEDULE_LABELS}) (temporal_schedule_observation_timestamp_seconds == on(${SCHEDULE_LABELS}) group_left max by(${SCHEDULE_LABELS}) (temporal_schedule_observation_timestamp_seconds))`;
}

function currentScheduleGaugeOverTime(
  metric: string,
  window = SCHEDULE_LOOKBACK,
): string {
  const observation = `last_over_time(temporal_schedule_observation_timestamp_seconds[${window}])`;
  return `last_over_time(${metric}[${window}]) and on(namespace,pod,${SCHEDULE_LABELS}) (${observation} == on(${SCHEDULE_IDENTITY_LABELS}) group_left max by(${SCHEDULE_IDENTITY_LABELS}) (${observation}))`;
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
          alert: "IncidentsSignalDeliveryFailing",
          annotations: {
            summary: escapePrometheusTemplate(
              "Incidents is not receiving {{ $labels.source }} signals",
            ),
            description: escapePrometheusTemplate(
              `Every ops-snapshot post of the {{ $labels.source }} signal to Hub's /api/incidents/internal/signals has failed for ${INCIDENTS_SIGNAL_FAILING_FOR}, so a red main neither opens nor clears an incident. The snapshot itself still publishes. Inspect the infra worker logs for module ops.incidents-signal and Hub's Incidents readiness at /readyz/incidents.`,
            ),
          },
          // The gauge is the last attempt's outcome, set on every run: it is
          // 0 from the first failure, including a worker that never succeeded.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "max by (source) (incidents_signal_post_ok) == 0",
          ),
          for: INCIDENTS_SIGNAL_FAILING_FOR,
          labels: { severity: "warning", category: "ops" },
        },
        {
          alert: "TemporalScheduledCurrentFailure",
          annotations: {
            summary: escapePrometheusTemplate(
              "Scheduled workflow {{ $labels.schedule_id }} failed its latest run",
            ),
            description: escapePrometheusTemplate(
              "The latest completed run of schedule {{ $labels.temporal_namespace }}/{{ $labels.schedule_id }} failed and has not yet succeeded on a subsequent run. Inspect the failed execution in the Temporal UI and the Ops maintenance dashboard.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `label_replace((max by (${SCHEDULE_IDENTITY_LABELS}) (${currentScheduleGaugeOverTime("temporal_schedule_last_terminal_failed")}) == 1) and on(${SCHEDULE_IDENTITY_LABELS}) (max by (${SCHEDULE_IDENTITY_LABELS}) (last_over_time(temporal_schedule_observation_timestamp_seconds[${SCHEDULE_LOOKBACK}])) > time() - 1800), "exported_namespace", "$1", "temporal_namespace", "(.+)")`,
          ),
          for: "10m",
          keepFiringFor: "15m",
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
