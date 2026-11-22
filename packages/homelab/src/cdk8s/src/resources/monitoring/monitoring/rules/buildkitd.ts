import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

// Keep in sync with GC_MAX_USED_BYTES / CACHE_PVC in resources/buildkitd.ts:
// BuildKit's GC keeps 480 GiB of the 600 GiB volume, so ~80% used is the
// DESIGNED steady state. Alert only above it — sustained >90% means GC is
// failing to reclaim, not that the cache is warm.
const CACHE_FILL_ALERT_RATIO = 0.9;

export function getBuildkitdRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "buildkitd-availability",
      rules: [
        {
          alert: "BuildkitdDown",
          annotations: {
            summary: "BuildKit CI builder daemon is down",
            description:
              "Prometheus cannot scrape buildkitd, and every CI container image build depends on this single daemon. Check the buildkitd pod status, events, and container logs in the buildkitd namespace.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(up{namespace="buildkitd"} == 0) or absent(up{namespace="buildkitd"})',
          ),
          for: "10m",
          labels: {
            severity: "warning",
            category: "ci",
          },
        },
        {
          // Full-fleet cold bakes previously OOM-crash-looped buildkitd at a
          // 12 GiB memory limit (PR #1668).
          alert: "BuildkitdRestarting",
          annotations: {
            summary: "BuildKit CI builder is restarting repeatedly",
            description: escapePrometheusTemplate(
              "The buildkitd container restarted {{ $value }} times in the last hour, interrupting in-flight CI image builds. Check pod termination reasons for OOMKills and review buildkitd memory limits or max-parallelism settings.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(kube_pod_container_status_restarts_total{namespace="buildkitd"}[1h]) > 2',
          ),
          for: "0m",
          labels: {
            severity: "warning",
            category: "ci",
          },
        },
      ],
    },
    {
      name: "buildkitd-storage",
      rules: [
        {
          alert: "BuildkitdCacheVolumeFilling",
          annotations: {
            summary: "BuildKit cache volume is over 90% full",
            description: escapePrometheusTemplate(
              "BuildKit cache PVC {{ $labels.persistentvolumeclaim }} has been {{ $value | humanizePercentage }} full for over an hour (~80% is the designed steady state where GC keeps 480Gi of 600Gi), meaning garbage collection is failing to reclaim space and image builds risk stalling. Inspect buildkitd disk usage, GC logs, and active build locks in the buildkitd namespace.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(kubelet_volume_stats_used_bytes{namespace="buildkitd", persistentvolumeclaim=~"buildkitd-cache.*"}
             / kubelet_volume_stats_capacity_bytes{namespace="buildkitd", persistentvolumeclaim=~"buildkitd-cache.*"}) > ${String(CACHE_FILL_ALERT_RATIO)}`,
          ),
          for: "1h",
          labels: {
            severity: "warning",
            category: "ci",
          },
        },
      ],
    },
  ];
}
