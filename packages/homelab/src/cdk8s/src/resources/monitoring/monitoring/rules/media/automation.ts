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
            summary: "Media commands are waiting for Temporal",
            description:
              "The oldest committed media command has waited more than five minutes. Inspect the media network worker and outbox dispatch schedule; keep the durable commands for retry.",
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
              "At least one active requester lacks recent current watch evidence for available media. Cleanup must remain protected. Inspect Plex access and the watch reconciliation schedule.",
          },
        },
        {
          alert: "MediaOperationsNeedReconciliation",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "media_operations_reconciling > 0",
          ),
          for: "15m",
          labels: { severity: "warning", category: "media" },
          annotations: {
            summary: "Media operations need reconciliation",
            description:
              "Media has operations awaiting reconciliation or intervention. Review their recorded outcome before retrying external writes, sending notifications again, or changing cleanup gates.",
          },
        },
      ],
    },
  ];
}
