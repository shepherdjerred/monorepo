import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

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
  kube_persistentvolumeclaim_info
)`;

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
          `(${zfsPvcUsageExpression}) > 0.75`,
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
          `(${zfsPvcUsageExpression}) > 0.90`,
        ),
        for: "5m",
        labels: { severity: "critical" },
      },
    ],
  };
}
