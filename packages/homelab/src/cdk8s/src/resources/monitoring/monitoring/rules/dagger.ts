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
            description: escapePrometheusTemplate(
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
            description: escapePrometheusTemplate(
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
        {
          // Burst detector. The 2026-07-03 outage filled ~670GB in 100 minutes
          // (a Renovate rebase wave rebuilt every dep branch at once); the plain
          // threshold alerts above fired only ~7 minutes before builds started
          // failing. predict_linear over a 15m window with a 2h horizon pages
          // ~70 minutes ahead of the wall for that fill rate. The >60% usage
          // guard keeps cold-cache rebuilds after a PV recreate (fast fill from
          // a near-empty volume) from paging. False-positive floor at
          // steady-state usage (~60% of 2Ti): ≥ ~120MB/s sustained for 10m+,
          // which only the storm itself has ever hit.
          // Post-mortem: packages/docs/logs/2026-07-03_dagger-engine-disk-full-outage.md
          alert: "DaggerEnginePVCFillPredicted",
          annotations: {
            summary: "Dagger engine cache PVC projected full within 2 hours",
            description: escapePrometheusTemplate(
              "Dagger engine PVC {{ $labels.persistentvolumeclaim }} is filling fast and is projected to hit " +
                "100% within 2 hours at the current write rate. A build storm is likely outrunning BuildKit GC; " +
                "at 100% the engine deadlocks (GC needs disk to prune). Expand the PVC online NOW — it is the " +
                "fastest, least disruptive fix. Runbook: packages/docs/guides/2026-06-07_dagger-engine-pvc-resize.md",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(predict_linear(kubelet_volume_stats_used_bytes{${pvcSelector}}[15m], 2 * 3600)
             > kubelet_volume_stats_capacity_bytes{${pvcSelector}})
             and
             (kubelet_volume_stats_used_bytes{${pvcSelector}}
             / kubelet_volume_stats_capacity_bytes{${pvcSelector}} > 0.6)`,
          ),
          for: "10m",
          labels: {
            severity: "critical",
            category: "storage",
          },
        },
      ],
    },
  ];
}
