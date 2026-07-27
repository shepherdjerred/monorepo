import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

// Keep in sync with GC_KEEP_BYTES / CACHE_PVC in resources/buildkitd.ts:
// BuildKit's GC keeps 240 GiB of the 300 GiB volume, so ~80% used is the
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
            summary: "buildkitd metrics target is down",
            message:
              "Prometheus cannot scrape buildkitd's debug endpoint. Every CI " +
              "image build depends on this single daemon (remote buildx " +
              "driver) — if the daemon itself is down, the images step fails " +
              "on main and PRs.",
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
          alert: "BuildkitdRestarting",
          annotations: {
            summary: "buildkitd is restarting repeatedly",
            message: escapePrometheusTemplate(
              "buildkitd restarted {{ $value }} times in the last hour. A " +
                "full-fleet cold bake previously OOM-crash-looped the daemon " +
                "at a 12Gi limit (PR #1668); repeated restarts suggest the " +
                "memory limit or max-parallelism needs revisiting.",
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
            summary: "buildkitd cache volume is filling past its GC floor",
            message: escapePrometheusTemplate(
              "buildkitd cache PVC {{ $labels.persistentvolumeclaim }} is " +
                "{{ $value | humanizePercentage }} full for over an hour. " +
                "~80% is the designed steady state (GC keeps 240Gi of " +
                "300Gi); sustained >90% means GC is not reclaiming and the " +
                "volume can fill, which freezes image builds.",
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
