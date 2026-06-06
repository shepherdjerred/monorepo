import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";
import { VELERO_SCHEDULES } from "@shepherdjerred/homelab/cdk8s/src/resources/velero-schedules.ts";

export const REVIEWED_LARGE_PVC_BACKUP_POLICY_MATCHERS = [
  {
    namespace: "dagger",
    persistentvolumeclaim: "data-dagger-dagger-helm-engine-0",
  },
  { namespace: "gickup", persistentvolumeclaim: "gickup-backup-pvc" },
  { namespace: "media", persistentvolumeclaim: "plex-movies-hdd-pvc" },
  { namespace: "media", persistentvolumeclaim: "plex-tv-hdd-pvc" },
  { namespace: "media", persistentvolumeclaim: "qbittorrent-hdd-pvc" },
  {
    namespace: "prometheus",
    persistentvolumeclaim:
      "prometheus-prometheus-kube-prometheus-prometheus-db-prometheus-prometheus-kube-prometheus-prometheus-0",
  },
  { namespace: "seaweedfs", persistentvolumeclaim: "data-seaweedfs-volume-0" },
];

const largePvcBackupPolicyReviewedSelector =
  REVIEWED_LARGE_PVC_BACKUP_POLICY_MATCHERS.map(
    ({ namespace, persistentvolumeclaim }) =>
      `kube_persistentvolumeclaim_resource_requests_storage_bytes{namespace="${namespace}",persistentvolumeclaim="${persistentvolumeclaim}"}`,
  ).join("\n  or ");

export const largePvcMayImpactBackupsExpr = `(
  kube_persistentvolumeclaim_resource_requests_storage_bytes > 200 * 1024 * 1024 * 1024
)
unless on (namespace, persistentvolumeclaim)
(
  ${largePvcBackupPolicyReviewedSelector}
)`;

export function getVeleroRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    // Velero backup size monitoring
    {
      name: "velero-backup-size",
      rules: [
        {
          record: "velero:pvc_volume_size_bytes",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes) by (namespace)`,
          ),
        },
        {
          record: "velero:pvc_total_size_bytes",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes)`,
          ),
        },
        {
          alert: "VeleroLargePVCMayImpactBackups",
          annotations: {
            summary: "Large PVC may impact Velero backups",
            message: escapePrometheusTemplate(
              "PVC {{ $labels.namespace }}/{{ $labels.persistentvolumeclaim }} requests {{ $value | humanize1024 }}B. kube-state-metrics is not exporting velero.io labels, so review the PVC backup policy manually.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            largePvcMayImpactBackupsExpr,
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "VeleroTotalPVCSizeExcessive",
          annotations: {
            summary: "Total PVC size is very large",
            message: escapePrometheusTemplate(
              "Total requested PVC storage is {{ $value | humanize1024 }}B. Large volumes can make Velero backups expensive or slow; review backup exclusions.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes) > 2 * 1024 * 1024 * 1024 * 1024`,
          ),
          for: "15m",
          labels: {
            severity: "info",
          },
        },
        {
          alert: "VeleroNamespacePVCSizeExcessive",
          annotations: {
            summary: "Namespace has large PVC volume size",
            message: escapePrometheusTemplate(
              "Namespace {{ $labels.namespace }} has {{ $value | humanize1024 }}B of requested PVC storage. Review backup policy and exclusions for this namespace.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes) by (namespace) > 500 * 1024 * 1024 * 1024`,
          ),
          for: "15m",
          labels: {
            severity: "info",
          },
        },
      ],
    },
    // Velero backup monitoring
    {
      name: "velero-backup",
      rules: [
        {
          alert: "VeleroBackupFailed",
          annotations: {
            summary: "Velero backup has failed",
            message: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} has failed",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max(velero_backup_last_status{schedule!=""}) by (schedule) != 1',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "VeleroBackupFailing",
          annotations: {
            summary: "Velero backup has been failing for extended period",
            message: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} has been failing for the last 12h",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max(velero_backup_last_status{schedule!=""}) by (schedule) != 1',
          ),
          for: "12h",
          labels: {
            severity: "critical",
          },
        },
        // Dynamically generate "no new backup" alerts from schedule configuration
        // Only alerts if the schedule has had at least one successful backup (prevents false positives for new schedules)
        ...VELERO_SCHEDULES.map((scheduleConfig) => ({
          alert: `VeleroNoNew${scheduleConfig.backupType.charAt(0).toUpperCase() + scheduleConfig.backupType.slice(1)}Backup`,
          annotations: {
            summary: `No new successful ${scheduleConfig.backupType} Velero backup`,
            message: escapePrometheusTemplate(
              `Velero backup {{ $labels.schedule }} has not had any successful backups in the last ${scheduleConfig.monitoring.noBackupWindow}`,
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(max(increase(velero_backup_success_total{schedule!="",schedule=~"${scheduleConfig.monitoring.schedulePattern}"}[${scheduleConfig.monitoring.noBackupWindow}])) by (schedule) == 0)
and on(schedule) (max(velero_backup_success_total{schedule!="",schedule=~"${scheduleConfig.monitoring.schedulePattern}"}) by (schedule) > 0)`,
          ),
          for: scheduleConfig.monitoring.alertFor,
          labels: {
            severity: scheduleConfig.monitoring.severity,
          },
        })),
        {
          alert: "VeleroBackupPartialFailures",
          annotations: {
            summary: "Velero backup experiencing partial failures",
            message: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} has {{ $value | humanizePercentage }} partially failed backups",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(rate(velero_backup_partial_failure_total{schedule!=""}[25m])) by (schedule)
  / sum(rate(velero_backup_attempt_total{schedule!=""}[25m])) by (schedule) > 0.5`,
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    // Velero restore monitoring
    {
      name: "velero-restore",
      rules: [
        {
          alert: "VeleroRestoreFailed",
          annotations: {
            summary: "Velero restore has failed",
            message: escapePrometheusTemplate(
              "Velero restore has failed - {{ $value }} failures in the last 15m",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(velero_restore_failed_total[15m]) > 0",
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "VeleroRestorePartialFailure",
          annotations: {
            summary: "Velero restore partially failed",
            message: escapePrometheusTemplate(
              "Velero restore has partial failures - {{ $value }} partial failures in the last 15m",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(velero_restore_partial_failure_total[15m]) > 0",
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "VeleroRestoreValidationFailed",
          annotations: {
            summary: "Velero restore validation failed",
            message: escapePrometheusTemplate(
              "Velero restore validation has failed - {{ $value }} validation failures in the last 15m",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(velero_restore_validation_failed_total[15m]) > 0",
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    // Velero volume snapshot monitoring
    {
      name: "velero-snapshots",
      rules: [
        {
          alert: "VeleroVolumeSnapshotFailed",
          annotations: {
            summary: "Velero volume snapshot failed",
            message: escapePrometheusTemplate(
              "Velero volume snapshot has failed - {{ $value }} failures in the last 15m",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(velero_volume_snapshot_failure_total[15m]) > 0",
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "VeleroCSISnapshotFailed",
          annotations: {
            summary: "Velero CSI snapshot failed",
            message: escapePrometheusTemplate(
              "Velero CSI snapshot has failed - {{ $value }} failures in the last 15m",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(velero_csi_snapshot_failure_total[15m]) > 0",
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "VeleroLargeVolumeBackupFailed",
          annotations: {
            summary: "Large volume backup attempt failed",
            message: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} failed with {{ $value }} volume snapshot errors. This may indicate attempts to backup large volumes that should be excluded.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(sum(rate(velero_volume_snapshot_failure_total[15m])) by (schedule) > 0)
  and on(schedule) (max(velero_backup_items_errors) by (schedule) > 0)`,
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "VeleroBackupDurationExcessive",
          annotations: {
            summary: "Velero backup taking too long",
            message: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} has exceeded 30 minutes duration. This may indicate large volumes are being backed up that should be excluded.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "max(velero_backup_duration_seconds) by (schedule) > 1800",
          ),
          for: "5m",
          labels: {
            severity: "info",
          },
        },
      ],
    },
    // Velero backup quality monitoring
    {
      name: "velero-backup-quality",
      rules: [
        {
          alert: "VeleroBackupValidationFailed",
          annotations: {
            summary: "Velero backup validation failed",
            message: escapePrometheusTemplate(
              "Velero backup validation has increased day-over-day - {{ $value }} new validation failures in the last 24h",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(velero_backup_validation_failure_total[6h]) > 0",
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "VeleroBackupWarnings",
          annotations: {
            summary: "Velero backup has warnings",
            message: escapePrometheusTemplate(
              "Velero backup has warnings - {{ $value }} warnings in the last 15m",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(velero_backup_warning_total[15m]) > 0",
          ),
          for: "15m",
          labels: {
            severity: "info",
          },
        },
        {
          alert: "VeleroBackupItemErrors",
          annotations: {
            summary: "Velero backup has item errors",
            message: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} has {{ $value }} item errors",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "max(velero_backup_items_errors) by (schedule) > 0",
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "VeleroHighErrorRate",
          annotations: {
            summary: "High percentage of backup item errors",
            message: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} has {{ $value | humanizePercentage }} error rate. Check for large volumes or excluded resources causing failures.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(max(velero_backup_items_errors) by (schedule) / max(velero_backup_items_total) by (schedule)) > 0.1`,
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    // Velero operational monitoring
    {
      name: "velero-operations",
      rules: [
        {
          alert: "VeleroBackupDeletionFailed",
          annotations: {
            summary: "Velero backup deletion failed",
            message: escapePrometheusTemplate(
              "Velero backup deletion has failed - {{ $value }} deletion failures in the last 30m. This may cause storage exhaustion.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(velero_backup_deletion_failure_total[30m]) > 0",
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    getVeleroOrphanSnapshotRuleGroup(),
  ];
}

// Detection layer for the Velero orphan-snapshot pathology — populated
// by the velero-orphan-audit Temporal workflow's daily run. See
// packages/docs/decisions/2026-05-05_velero-orphan-snapshot-prevention.md
// and packages/docs/guides/2026-05-05_velero-orphan-snapshot-remediation.md.
function getVeleroOrphanSnapshotRuleGroup(): PrometheusRuleSpecGroups {
  return {
    name: "velero-orphan-snapshots",
    rules: [
      {
        alert: "VeleroOrphanLocalSnapshots",
        annotations: {
          summary: "Velero orphan ZFS snapshots detected",
          message: escapePrometheusTemplate(
            "Velero orphan local ZFS snapshots present: {{ $value }} snapshot(s) cluster-wide have no matching live Velero Backup CR. Run the remediation runbook at packages/docs/guides/2026-05-05_velero-orphan-snapshot-remediation.md.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "velero_orphan_local_snapshots_total > 0",
        ),
        for: "24h",
        labels: {
          severity: "warning",
        },
      },
      {
        alert: "VeleroOrphanLocalBytesExcessive",
        annotations: {
          summary: "Velero orphan ZFS snapshots consuming significant disk",
          message: escapePrometheusTemplate(
            "Velero orphan local ZFS snapshots consume {{ $value | humanize1024 }}B cluster-wide. Run the remediation runbook to reclaim space.",
          ),
        },
        // 1 GiB ceiling — anything above this is worth surfacing
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "velero_orphan_local_bytes_total > 1024 * 1024 * 1024",
        ),
        for: "24h",
        labels: {
          severity: "warning",
        },
      },
      {
        alert: "ZFSDatasetSnapshotCountExcessive",
        annotations: {
          summary: "PVC dataset has excessive ZFS snapshot count",
          message: escapePrometheusTemplate(
            "Dataset {{ $labels.dataset }} has {{ $value }} ZFS snapshots; expected at most ~26 (sum of schedule retention slots). May indicate orphan accumulation; cross-check with velero_orphan_local_snapshots.",
          ),
        },
        // Backstop: catches accumulation regardless of whether the audit workflow runs.
        // Threshold is generous — 35 = 26 expected + 35% headroom for transient overlap.
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "max by (dataset) (zfs_dataset_snapshot_count) > 35",
        ),
        for: "6h",
        labels: {
          severity: "warning",
        },
      },
      {
        alert: "VeleroOrphanAuditNotRunning",
        annotations: {
          summary:
            "velero-orphan-audit workflow has not run successfully recently",
          message: escapePrometheusTemplate(
            "The velero-orphan-audit Temporal workflow has not incremented its success counter in 36h+. Detection metrics may be stale. Investigate the workflow in the Temporal UI.",
          ),
        },
        // Workflow runs daily at 03:30 PT; alert if success metrics disappear
        // for 36h. The counter is low-frequency and resets on worker rollouts,
        // so rate/increase are unreliable freshness checks.
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'absent_over_time(velero_orphan_audit_runs_total{outcome="success"}[36h])',
        ),
        for: "1h",
        labels: {
          severity: "warning",
        },
      },
    ],
  };
}
