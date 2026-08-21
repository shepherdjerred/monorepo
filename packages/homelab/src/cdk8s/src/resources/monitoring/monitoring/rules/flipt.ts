import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";

export function getFliptRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "flipt-health",
      rules: [
        {
          alert: "FliptDown",
          annotations: {
            summary: "Flipt feature flag server is down",
            message:
              "Flipt has no healthy scrape target. Flag values are frozen at whatever each service last cached, and no flag can be changed until it returns.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(up{namespace="flipt",service="flipt-flipt-service"} == 0) or absent(up{namespace="flipt",service="flipt-flipt-service"})',
          ),
          for: "5m",
          labels: { severity: "critical" },
        },
        {
          alert: "FeatureFlagSnapshotStale",
          annotations: {
            summary: "A service's feature flag snapshot is stale",
            message:
              "A service has not refreshed its flag snapshot in over an hour. It keeps serving the last good values, so nothing looks broken — this alert is the only signal that flag changes are no longer reaching it.",
          },
          // The client keeps serving its last good snapshot through an outage,
          // so evaluations still succeed and error rates stay flat. Age is the
          // only thing that moves, which is why per-evaluation reporting was
          // deliberately not used: it would emit one event per flag read and
          // bury this.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "feature_flag_snapshot_age_seconds > 3600",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
        {
          alert: "FeatureFlagProviderInitFailing",
          annotations: {
            summary: "A service failed to initialize its feature flag provider",
            message:
              "A provider failed to initialize, so every flag in that pod reports PROVIDER_NOT_READY and resolves to its call-site default until the pod restarts. There is no retry in v1.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(feature_flag_errors_total{operation="initialize"}[15m]) > 0',
          ),
          for: "5m",
          labels: { severity: "warning" },
        },
      ],
    },
  ];
}
