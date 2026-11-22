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
// The filer keeps a disconnected subscriber's series, so its absence only
// proves the backup never attached; a stale series shows up as lag instead.
const BACKUP_AVAILABLE = `kube_deployment_status_replicas_available{namespace="seaweedfs",deployment="seaweedfs-backup"}`;

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
            summary: "SeaweedFS volume creation is failing",
            description: escapePrometheusTemplate(
              'SeaweedFS recorded {{ $value | printf "%.0f" }} volume creation failure(s) in the last 15 minutes, causing object writes that need a new volume to fail with HTTP 500 and breaking static-site CI deploys. Check seaweedfs-master and seaweedfs-volume logs for volume slot exhaustion (maxVolumes) or low disk space.',
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
            summary: "SeaweedFS unable to create volumes for over 30 minutes",
            description: escapePrometheusTemplate(
              'SeaweedFS volume creation has been failing for over 30 minutes ({{ $value | printf "%.0f" }} failure(s) in the last 15m), blocking new object storage writes across the cluster. Expand maxVolumes or volumeSizeLimitMB, or free disk space on the seaweedfs-volume PVC.',
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
            summary: "SeaweedFS off-site backup to Backblaze is not running",
            description:
              "The seaweedfs-backup deployment has no available replicas or has never attached to the SeaweedFS filer, so new and updated objects are not replicating to Backblaze B2. Check seaweedfs-backup pod status and logs in the seaweedfs namespace.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `absent(${BACKUP_SENT}) or max(${BACKUP_AVAILABLE}) < 1`,
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "SeaweedFSBackupLagging",
          annotations: {
            summary: "SeaweedFS off-site backup to Backblaze is lagging",
            description: escapePrometheusTemplate(
              "SeaweedFS backup replication is {{ $value | humanizeDuration }} behind the filer, leaving recent object writes unprotected in Backblaze B2. Inspect seaweedfs-backup pod logs for Backblaze B2 connectivity, auth, or rate-limit errors.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(max(${FILER_SENT}) - max(${BACKUP_SENT})) / 1e9 > 3600`,
          ),
          for: "30m",
          keepFiringFor: "15m",
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
            summary: "SeaweedFS storage volume is over 95% full",
            description: escapePrometheusTemplate(
              "SeaweedFS volume PVC {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full, risking imminent volume creation and object write failures. Prune unneeded objects (for example via scout-image-gc or volume vacuuming) or expand the PVC.",
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
