import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

// The Dagger engine's BuildKit cache lives on a single ZFS-backed PVC
// (data-dagger-dagger-helm-engine-0). When that PVC hits its ZFS dataset quota,
// writes fail with EDQUOT mid-build and CI image pushes / tofu applies die with
// "disk quota exceeded" — exactly the 2026-06-08 main-CI outage (build 3668).
//
// The engine's own GC (maxUsedSpace) only bounds the *reclaimable* cache, not
// total dataset usage (metadata DBs + in-flight leases are uncounted), so GC
// alone does not guarantee headroom under a heavy concurrent build. These alerts
// are the early-warning net: they fire well before the quota wall so the PVC can
// be expanded (see runbook) before a build goes red.
//
// kubelet_volume_stats reflects the ZFS `quota` (set directly on the dataset, so
// it shows in statfs), making used/capacity an accurate approach-to-quota signal.
// Resize runbook: packages/docs/guides/2026-06-07_dagger-engine-pvc-resize.md
export function getDaggerEngineRuleGroups(): PrometheusRuleSpecGroups[] {
  const pvcSelector = `namespace="dagger", persistentvolumeclaim="data-dagger-dagger-helm-engine-0"`;
  return [
    {
      name: "dagger-engine-storage",
      rules: [
        {
          alert: "DaggerEnginePVCStorageHigh",
          annotations: {
            summary: "Dagger engine cache PVC usage is high",
            message: escapePrometheusTemplate(
              "Dagger engine PVC {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full. " +
                "Approaching the ZFS quota; a heavy build can hit EDQUOT and fail CI. Expand the PVC or lower GC maxUsedSpace. " +
                "Runbook: packages/docs/guides/2026-06-07_dagger-engine-pvc-resize.md",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(kubelet_volume_stats_used_bytes{${pvcSelector}}
             / kubelet_volume_stats_capacity_bytes{${pvcSelector}}) > 0.85`,
          ),
          for: "15m",
          labels: {
            severity: "warning",
            category: "storage",
          },
        },
        {
          alert: "DaggerEnginePVCStorageCritical",
          annotations: {
            summary: "Dagger engine cache PVC is nearly full",
            message: escapePrometheusTemplate(
              "Dagger engine PVC {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full. " +
                "Imminent EDQUOT risk — CI image pushes and tofu applies will fail. Expand the PVC now. " +
                "Runbook: packages/docs/guides/2026-06-07_dagger-engine-pvc-resize.md",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(kubelet_volume_stats_used_bytes{${pvcSelector}}
             / kubelet_volume_stats_capacity_bytes{${pvcSelector}}) > 0.95`,
          ),
          for: "5m",
          labels: {
            severity: "critical",
            category: "storage",
          },
        },
      ],
    },
  ];
}
