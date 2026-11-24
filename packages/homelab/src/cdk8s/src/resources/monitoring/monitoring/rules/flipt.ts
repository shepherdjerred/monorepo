import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getFliptRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "flags-health",
      rules: [
        {
          alert: "FeatureFlagExceptionReviewOverdue",
          annotations: {
            summary: escapePrometheusTemplate(
              "Feature flag {{ $labels.flag }} review is overdue",
            ),
            description: escapePrometheusTemplate(
              "Default-off exception {{ $labels.issue }} for flag {{ $labels.flag }} in {{ $labels.flipt_environment }}/{{ $labels.flipt_namespace }} is past its review date. Review the linked Tracker issue and either enable the flag, remove it, or extend the exception.",
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
            summary: escapePrometheusTemplate(
              "Feature flag {{ $labels.flag }} evaluations are failing",
            ),
            description: escapePrometheusTemplate(
              "Service {{ $labels.job }} is recording evaluation errors for feature flag {{ $labels.flag }}, causing callers to fall back to default values. Check Flags connectivity, flag key spelling, and evaluation context types in {{ $labels.job }} logs.",
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
            summary: "Feature flag rollout inventory is stale",
            description:
              "The feature flag inventory observer has not recorded a fresh snapshot in over 10 minutes, leaving live flag rollout state unknown on dashboards and audits. Check Flags health and the inventory observer worker logs.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '((max by (flipt_environment, flipt_namespace) (feature_flag_inventory_expected{container="temporal-repo-worker"}) == 1) unless on (flipt_environment, flipt_namespace) (max by (flipt_environment, flipt_namespace) (feature_flag_inventory_observed_timestamp_seconds) > time() - 600)) or absent(feature_flag_inventory_expected{container="temporal-repo-worker"})',
          ),
          for: "5m",
          labels: { severity: "warning" },
        },
        {
          alert: "FlagsDown",
          annotations: {
            summary: "Flags feature flag server is down",
            description:
              "Prometheus cannot scrape Flags, so services are frozen on their last cached flag snapshots and flag updates cannot propagate. Check pod status, logs, and readiness probes in the flags namespace.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(up{namespace="flags",service="flags"} == 0) or absent(up{namespace="flags",service="flags"})',
          ),
          for: "5m",
          labels: { severity: "critical" },
        },
        {
          alert: "FeatureFlagSnapshotStale",
          annotations: {
            summary: "Service feature flag cache has not refreshed",
            description: escapePrometheusTemplate(
              "Service {{ $labels.job }} ({{ $labels.instance }}) has not refreshed its feature flag snapshot in over 1 hour, so it continues serving cached values and misses flag changes. Check Flags reachability and client polling logs in {{ $labels.job }}.",
            ),
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
            summary: "Service failed to connect to feature flags",
            description: escapePrometheusTemplate(
              "Feature flag provider initialization is failing in {{ $labels.job }} ({{ $labels.instance }}), forcing every flag read in that pod to use hardcoded call-site defaults. Check Flags server status, deployment configuration, and startup logs for {{ $labels.job }}.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(feature_flag_provider_ready == 0) and on (job, instance) feature_flag_provider_info",
          ),
          for: "5m",
          labels: { severity: "warning" },
        },
      ],
    },
  ];
}
