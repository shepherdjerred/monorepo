import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

/**
 * Dataset quota usage joined to the claim that owns the dataset.
 *
 * `zfs_dataset_used_bytes` carries no namespace, only the dataset name, so
 * the claim is found by volumename. A volumename is not unique among claims:
 * a Velero restore into its own namespace recreates the claim with the live
 * PV's volumeName and leaves it Pending, so two claims name one volume. Only
 * the Bound claim owns the dataset, so the claim side is reduced to Bound
 * claims first; otherwise the join is many-to-many and the rule fails to
 * evaluate. The phase series is aggregated by claim so a second
 * kube-state-metrics instance during a rollout cannot duplicate it.
 */
export const zfsPvcUsageExpression = `label_replace(
  zfs_dataset_used_bytes{dataset_name=~".*/pvc-.*"}
  /
  (
    zfs_dataset_used_bytes{dataset_name=~".*/pvc-.*"}
    + zfs_dataset_available_bytes{dataset_name=~".*/pvc-.*"}
  ),
  "volumename",
  "$1",
  "dataset_name",
  ".*/(pvc-.*)"
)
* on (volumename) group_left(namespace, persistentvolumeclaim)
max by (volumename, namespace, persistentvolumeclaim) (
  kube_persistentvolumeclaim_info{volumename!=""}
  * on (namespace, persistentvolumeclaim) group_left()
  max by (namespace, persistentvolumeclaim) (
    kube_persistentvolumeclaim_status_phase{phase="Bound"} == 1
  )
)`;

const BUILDKITD_CACHE_PVC_SELECTOR =
  'kube_persistentvolumeclaim_info{namespace="buildkitd",persistentvolumeclaim=~"buildkitd-cache.*"}';

function excludeBuildkitdCache(expression: string): string {
  return `(${expression}) unless on (namespace, persistentvolumeclaim) ${BUILDKITD_CACHE_PVC_SELECTOR}`;
}

export function getZfsPvcRuleGroup(): PrometheusRuleSpecGroups {
  return {
    name: "resource-zfs-pvc-monitoring",
    rules: [
      {
        alert: "ZfsPVCStorageHigh",
        annotations: {
          description: escapePrometheusTemplate(
            "ZFS PVC {{ $labels.namespace }}/{{ $labels.persistentvolumeclaim }} uses {{ $value | humanizePercentage }} of its quota including snapshot-retained blocks.",
          ),
          summary: "ZFS PVC storage usage above 75%",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          excludeBuildkitdCache(`(${zfsPvcUsageExpression}) > 0.75`),
        ),
        for: "15m",
        labels: { severity: "warning" },
      },
      {
        alert: "ZfsPVCStorageCritical",
        annotations: {
          description: escapePrometheusTemplate(
            "ZFS PVC {{ $labels.namespace }}/{{ $labels.persistentvolumeclaim }} uses {{ $value | humanizePercentage }} of its quota including snapshot-retained blocks.",
          ),
          summary: "ZFS PVC storage usage above 90%",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          excludeBuildkitdCache(`(${zfsPvcUsageExpression}) > 0.90`),
        ),
        for: "5m",
        labels: { severity: "critical" },
      },
    ],
  };
}
