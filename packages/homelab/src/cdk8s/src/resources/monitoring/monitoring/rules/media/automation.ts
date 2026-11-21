import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";

export function getMediaRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "media-automation",
      rules: [
        {
          alert: "MediaOutboxStalled",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "media_outbox_oldest_age_seconds > 300",
          ),
          for: "1m",
          labels: { severity: "warning", category: "media" },
          annotations: {
            summary: "Media outbox commands are delayed waiting for Temporal",
            description:
              "Committed media automation commands have waited in the outbox for more than 5 minutes without being dispatched, delaying media requests and notifications. Check the Temporal media-network worker health and the outbox dispatch schedule, leaving queued outbox rows intact for retry.",
          },
        },
        {
          alert: "MediaWatchEvidenceStale",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "time() - media_watch_evidence_oldest_timestamp_seconds > 900 and on (namespace, pod) media_watch_evidence_required == 1 and on (namespace, pod) media_runtime_active == 1",
          ),
          for: "1m",
          labels: { severity: "warning", category: "media" },
          annotations: {
            summary: "Media watch evidence is stale or incomplete",
            description:
              "Active media requesters are missing watch-history evidence from the last 15 minutes, blocking automated library cleanup so unwatched media is not deleted prematurely. Check Plex connectivity and the Temporal watch-evidence reconciliation schedule.",
          },
        },
        {
          alert: "MediaOperationsNeedReconciliation",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "max by (namespace) (media_operations_reconciling and on (namespace, pod) media_runtime_active == 1) > 0",
          ),
          for: "15m",
          labels: { severity: "warning", category: "media" },
          annotations: {
            summary: "Media operations are awaiting manual reconciliation",
            description:
              "One or more media automation operations have been awaiting reconciliation for over 15 minutes, leaving downstream downloads, notifications, or cleanup gates paused. Inspect the pending operations and verify their recorded external state before retrying writes or clearing gates.",
          },
        },
      ],
    },
  ];
}
