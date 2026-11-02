import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";
import { SEAWEEDFS_BACKUP_CLIENT } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/storage/seaweedfs-backup.ts";

// filer.backup exports no metrics of its own. The filer reports, per metadata
// subscriber, the timestamp of the last event it sent; a subscriber that stops
// writing to Backblaze stops receiving, so that timestamp falls behind. Lag is
// measured against the filer's own subscriber, which sees every event, so a
// quiet hour with no writes is not lag.
const BACKUP_SENT = `SeaweedFS_filer_last_send_timestamp_of_subscribe{clientName="${SEAWEEDFS_BACKUP_CLIENT}"}`;
const FILER_SENT = `SeaweedFS_filer_last_send_timestamp_of_subscribe{clientName=~"filer:.*"}`;

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
      name: "seaweedfs-backup",
      rules: [
        {
          alert: "SeaweedFSBackupNotRunning",
          annotations: {
            summary: "SeaweedFS objects are not being copied to Backblaze",
            message:
              "No filer.backup subscriber is attached to the SeaweedFS filer. New and changed objects are not reaching the Backblaze seaweedfs-backups bucket. Check the seaweedfs-backup Deployment.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `absent(${BACKUP_SENT})`,
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "SeaweedFSBackupLagging",
          annotations: {
            summary: "SeaweedFS backup to Backblaze is behind",
            message: escapePrometheusTemplate(
              "filer.backup is {{ $value | humanizeDuration }} behind the SeaweedFS filer. Recent object changes are not yet in Backblaze. Check the seaweedfs-backup logs for sink errors.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(max(${FILER_SENT}) - max(${BACKUP_SENT})) / 1e9 > 3600`,
          ),
          for: "30m",
          labels: {
            severity: "warning",
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
