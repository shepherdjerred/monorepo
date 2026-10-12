import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

export function getClusterHygieneRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "cluster-hygiene",
      rules: [
        {
          alert: "ZfsDatasetDeletionStuck",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max by (node,dataset_name) (zfs_dataset_referenced_bytes) and on (node,dataset_name) (time() - max by (node,dataset_name) (zfs_deleting_volume_timestamp_seconds{container="temporal-infra-worker"} and on (namespace,pod) (zfs_deletion_inventory_timestamp_seconds{container="temporal-infra-worker"} == on () group_left max(zfs_deletion_inventory_timestamp_seconds{container="temporal-infra-worker"}))) > 3600) and on () (max(zfs_deletion_inventory_timestamp_seconds{container="temporal-infra-worker"}) > time() - 900)',
          ),
          for: "5m",
          labels: { severity: "warning" },
          annotations: {
            summary: "ZFS dataset deletion has remained busy for over an hour",
            message:
              "The alert value is actual referenced bytes. Capture holder diagnostics before targeted recovery; do not force-destroy the dataset or remove its finalizer.",
          },
        },
        {
          alert: "AlloyUnwindTableHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'agent_unwind_info_array_size{namespace="alloy"} / 16384 > 0.90',
          ),
          for: "15m",
          labels: { severity: "warning" },
          annotations: {
            summary: "Alloy unwind table above 90%",
            message:
              "Inspect executable extraction errors and capture evidence before targeted manual recovery. Map scale does not increase this table.",
          },
        },
        {
          alert: "AlloyUnwindTableCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'agent_unwind_info_array_size{namespace="alloy"} / 16384 > 0.98',
          ),
          for: "5m",
          labels: { severity: "critical" },
          annotations: {
            summary: "Alloy unwind table nearly full",
            message:
              "Capture diagnostics and recover only the affected node profiler after verifying its peer. No automatic restarts.",
          },
        },
        {
          alert: "AlloyExecutableProfilingFailures",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(agent_errors_stack_delta_provider_extraction_total{namespace="alloy"}[15m]) > 0',
          ),
          for: "15m",
          labels: { severity: "warning" },
          annotations: {
            summary: "Alloy cannot profile some executables",
            message:
              "Inspect profiler logs for unsupported Go versions and unwind-table exhaustion. Healthy profiling sessions do not establish complete executable coverage.",
          },
        },
        {
          alert: "ReleasedPVsAccumulating",
          annotations: {
            summary: "Released PersistentVolumes are accumulating",
            message: escapePrometheusTemplate(
              'There are {{ $value }} PersistentVolumes in "Released" state. These should be cleaned up or reclaimed.',
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
            summary: "Prometheus TSDB data continuity is less than 24 hours",
            message: escapePrometheusTemplate(
              "Prometheus oldest TSDB data is only {{ $value | humanize }}s old. Historical data may have been lost.",
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
            summary: "High ratio of BestEffort QoS pods in the cluster",
            message: escapePrometheusTemplate(
              "{{ $value | humanizePercentage }} of pods are running with BestEffort QoS. Consider setting resource requests/limits.",
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
