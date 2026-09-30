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
      ],
    },
  ];
}
