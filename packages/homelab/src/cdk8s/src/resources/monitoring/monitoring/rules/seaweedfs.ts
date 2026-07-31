import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

// SeaweedFS alerting. The store twice reded main CI when the volume server ran out
// of volume *slots* (maxVolumes) and every PutObject needing a fresh volume got an
// HTTP 500 "No writable volumes" — a failure mode with no alert until now (the only
// coverage was the generic byte-level PVCStorageHigh). The direct signal is
// SeaweedFS_master_volume_creation_total{result="failure"}, a counter that only
// climbs while volume creation is actively failing (slot exhaustion or disk full).
// The volumeSizeLimitMB=30000 change makes bytes-on-disk the real governor, so we
// also add a critical disk tier for the volume PVC on top of the generic warning.
export function getSeaweedfsRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "seaweedfs-volumes",
      rules: [
        {
          alert: "SeaweedFSVolumeCreationFailing",
          annotations: {
            summary: "SeaweedFS cannot create new volumes",
            message: escapePrometheusTemplate(
              "SeaweedFS volume creation is failing ({{ $value }} failures in 15m). PutObject returns 500 'No writable volumes' — static-site CI deploys will fail. Check volume-slot exhaustion (maxVolumes) or disk on seaweedfs-volume.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(SeaweedFS_master_volume_creation_total{result="failure"}[15m]) > 0',
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "SeaweedFSVolumeCreationFailingCritical",
          annotations: {
            summary:
              "SeaweedFS has been unable to create volumes for 30+ minutes",
            message: escapePrometheusTemplate(
              "SeaweedFS volume creation has been failing for 30+ minutes. Object writes are broken (500 'No writable volumes'). Raise maxVolumes / volumeSizeLimitMB or free disk on seaweedfs-volume.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(SeaweedFS_master_volume_creation_total{result="failure"}[15m]) > 0',
          ),
          for: "30m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
    {
      name: "seaweedfs-storage",
      rules: [
        {
          alert: "SeaweedFSVolumePVCStorageCritical",
          annotations: {
            summary: "SeaweedFS volume PVC is nearly full",
            message: escapePrometheusTemplate(
              "SeaweedFS volume PVC {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full. Disk is now the governing limit for volume growth — free data (scout-image-gc) or expand the PVC before writes start failing.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(kubelet_volume_stats_used_bytes{namespace="seaweedfs", persistentvolumeclaim=~"data-seaweedfs-volume.*"}
             / kubelet_volume_stats_capacity_bytes{namespace="seaweedfs", persistentvolumeclaim=~"data-seaweedfs-volume.*"}) > 0.95`,
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
  ];
}
