import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

export function getClusterHygieneRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "cluster-hygiene",
      rules: [
        // The alert value carries zfs_dataset_referenced_bytes for operator context.
        {
          alert: "ZfsDatasetDeletionStuck",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max by (node,dataset_name) (zfs_dataset_referenced_bytes) and on (node,dataset_name) (time() - max by (node,dataset_name) (zfs_deleting_volume_timestamp_seconds{container="temporal-infra-worker"} and on (namespace,pod) (zfs_deletion_inventory_timestamp_seconds{container="temporal-infra-worker"} == on () group_left max(zfs_deletion_inventory_timestamp_seconds{container="temporal-infra-worker"}))) > 3600) and on () (max(zfs_deletion_inventory_timestamp_seconds{container="temporal-infra-worker"}) > time() - 900)',
          ),
          for: "5m",
          labels: { severity: "warning" },
          annotations: {
            summary: "ZFS dataset deletion has been stuck for over an hour",
            description: escapePrometheusTemplate(
              "ZFS dataset {{ $labels.dataset_name }} on node {{ $labels.node }} ({{ $value | humanize1024 }}B referenced) has failed to delete for over an hour, retaining storage on the pool. Inspect open-handle diagnostics on the node before targeted recovery; do not force-destroy the dataset or remove its finalizer.",
            ),
          },
        },
        // The unwind table holds 16,384 entries (map scale does not increase
        // this table) and plateaus near 96% on a busy node, so a percentage
        // threshold fires permanently. Alert only when it is full and the
        // profiler starts rejecting executables; the Loki rule
        // AlloyUnwindInfoArrayFull reports the rejections themselves.
        {
          alert: "AlloyUnwindTableFull",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'agent_unwind_info_array_size{namespace="alloy"} >= 16384',
          ),
          for: "5m",
          labels: { severity: "warning" },
          annotations: {
            summary: "Node CPU profiler lookup table is full",
            description: escapePrometheusTemplate(
              "Alloy profiler pod {{ $labels.pod }} has filled its 16,384-entry unwind table, so CPU profiles for newly started executables on that node will be missing. Inspect diagnostics from the pod and restart only the affected node profiler after verifying peer Alloy pods are healthy; do not configure automatic restarts.",
            ),
          },
        },
        // Healthy profiling sessions alone do not establish complete executable coverage.
        {
          alert: "AlloyExecutableProfilingFailures",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(agent_errors_stack_delta_provider_extraction_total{namespace="alloy"}[15m]) > 0',
          ),
          for: "15m",
          labels: { severity: "warning" },
          annotations: {
            summary: "Node CPU profiler cannot read some binaries",
            description: escapePrometheusTemplate(
              "Alloy profiler pod {{ $labels.pod }} failed to extract unwind information for {{ $value | humanize }} executable(s) in the last 15 minutes, leaving gaps in continuous profiling coverage. Inspect the Alloy pod logs for unsupported binary formats, Go version mismatches, or unwind-table exhaustion.",
            ),
          },
        },
        {
          alert: "ReleasedPVsAccumulating",
          annotations: {
            summary: "Unused storage volumes are piling up",
            description: escapePrometheusTemplate(
              "{{ $value }} PersistentVolumes have remained in the Released state for over 24 hours, holding backing storage that cannot be bound to new claims. Run kubectl get pv to inspect Released volumes and delete or reclaim any whose data is no longer needed.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(kube_persistentvolume_status_phase{phase="Released"}) > 5',
          ),
          for: "24h",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "PrometheusDataContinuityLost",
          annotations: {
            summary: "Prometheus metrics history spans less than 24 hours",
            description: escapePrometheusTemplate(
              "The oldest data in Prometheus is only {{ $value | humanizeDuration }} old, meaning historical metrics were lost or reset and multi-day recording rules and forecasts are degraded. Check whether the Prometheus PVC was recreated or wiped and inspect Prometheus startup and WAL logs.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "time() - prometheus_tsdb_lowest_timestamp_seconds < 86400",
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "HighBestEffortPodRatio",
          annotations: {
            summary: "Over half of cluster pods have no resource requests",
            description: escapePrometheusTemplate(
              "{{ $value | humanizePercentage }} of pods have no CPU or memory requests or limits, reducing scheduler visibility and making eviction order less predictable under node pressure. Inspect workloads missing resource specs and add appropriate requests and limits in cdk8s.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'count(kube_pod_status_qos_class{qos_class="BestEffort"}) / count(kube_pod_status_qos_class) > 0.5',
          ),
          for: "1h",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
