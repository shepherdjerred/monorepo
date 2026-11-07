import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getFliptRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "flipt-health",
      rules: [
        {
          alert: "FeatureFlagExceptionReviewOverdue",
          annotations: {
            summary: "A feature flag exception needs review",
            message: escapePrometheusTemplate(
              "Default-off exception {{ $labels.issue }} for {{ $labels.flag }} in {{ $labels.flipt_environment }}/{{ $labels.flipt_namespace }} is overdue. Review its enablement criteria.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "time() > max by (flipt_environment, flipt_namespace, flag, issue) (feature_flag_exception_review_timestamp_seconds)",
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
        {
          alert: "FeatureFlagEvaluationErrors",
          annotations: {
            summary: "Feature flag evaluations are failing",
            message: escapePrometheusTemplate(
              "{{ $labels.job }} is evaluating {{ $labels.flag }} with ERROR results. Check the provider and flag contract; explicit false is not an error.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum by (job, flag) (rate(feature_flag_evaluations_total{reason="ERROR"}[5m])) > 0',
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
        {
          alert: "FeatureFlagInventoryObservationStale",
          annotations: {
            summary: "Live feature flag inventory is not being observed",
            message:
              "The inventory observer has no successful snapshot in the last ten minutes. Rollout state must be treated as unknown until observation recovers.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "((max by (flipt_environment, flipt_namespace) (feature_flag_inventory_expected) == 1) unless on (flipt_environment, flipt_namespace) (max by (flipt_environment, flipt_namespace) (feature_flag_inventory_observed_timestamp_seconds) > time() - 600)) or absent(feature_flag_inventory_expected)",
          ),
          for: "5m",
          labels: { severity: "warning" },
        },
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
              "A provider is not ready, so every flag in that pod reports PROVIDER_NOT_READY and resolves to its call-site default while initialization retries in the background.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "feature_flag_provider_ready == 0",
          ),
          for: "5m",
          labels: { severity: "warning" },
        },
      ],
    },
  ];
}
