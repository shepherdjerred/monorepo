import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";
import { VELERO_SCHEDULES } from "@shepherdjerred/homelab/cdk8s/src/resources/velero/velero-schedules.ts";
import { zfsPvcUsedBytesExpression } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/platform/resource-monitoring-zfs.ts";

/**
 * Actual ZFS usage of the claims the Velero schedules select, including blocks
 * retained by local snapshots. Requested capacity is not backup cost: a large,
 * mostly empty claim would otherwise alert despite transferring little data.
 * Every schedule's labelSelector is `velero.io/backup=enabled`
 * (resources/argo-applications/storage/velero.ts), and kube-state-metrics
 * exports that label (persistentvolumeclaims=[velero.io/backup] in
 * grafana-values.ts). Disposable caches and unlabelled claims are never backed
 * up, so their size says nothing about backup cost. `max by` collapses the
 * duplicate label series a second kube-state-metrics replica exports during a
 * rollout.
 */
const BACKED_UP_PVC_USED_BYTES = `${zfsPvcUsedBytesExpression}
* on (namespace, persistentvolumeclaim) group_left()
max by (namespace, persistentvolumeclaim) (kube_persistentvolumeclaim_labels{label_velero_io_backup="enabled"})`;

export function getVeleroRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    // Velero backup size monitoring
    {
      name: "velero-backup-size",
      rules: [
        {
          record: "velero:pvc_volume_size_bytes",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum by (namespace) (${BACKED_UP_PVC_USED_BYTES})`,
          ),
        },
        {
          record: "velero:pvc_total_size_bytes",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(${BACKED_UP_PVC_USED_BYTES})`,
          ),
        },
        {
          alert: "VeleroTotalPVCSizeExcessive",
          annotations: {
            summary: "Total Velero-backed PVC data exceeds 2 TiB",
            description: escapePrometheusTemplate(
              "Velero-backed PVCs use {{ $value | humanize1024 }}B of ZFS storage cluster-wide (including local snapshots), increasing backup duration and object-storage costs. Review PVC velero.io/backup labels and exclude disposable caches or rebuildable data.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(${BACKED_UP_PVC_USED_BYTES}) > 2 * 1024 * 1024 * 1024 * 1024`,
          ),
          for: "15m",
          labels: {
            severity: "info",
          },
        },
        {
          alert: "VeleroNamespacePVCSizeExcessive",
          annotations: {
            summary: escapePrometheusTemplate(
              "Velero-backed PVC data in {{ $labels.namespace }} exceeds 500 GiB",
            ),
            description: escapePrometheusTemplate(
              "PVCs opted into Velero backups in namespace {{ $labels.namespace }} consume {{ $value | humanize1024 }}B of ZFS storage (including local snapshots), slowing scheduled backups. Review PVCs in {{ $labels.namespace }} and disable backup labels on caches or non-critical volumes.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum by (namespace) (${BACKED_UP_PVC_USED_BYTES}) > 500 * 1024 * 1024 * 1024`,
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
          alert: "VeleroBackupResourceFailed",
          annotations: {
            summary: escapePrometheusTemplate(
              "Latest completed Velero backup failed for {{ $labels.schedule }}",
            ),
            description: escapePrometheusTemplate(
              "The most recent completed Backup resource for schedule {{ $labels.backup_namespace }}/{{ $labels.schedule }} ended in a Failed or PartiallyFailed state, leaving recent cluster state unprotected until a new run finishes cleanly. Run velero backup describe and velero backup logs on the failed Backup CR to diagnose the error.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(max by(backup_namespace,schedule) (velero_schedule_last_terminal_failed and on(namespace,pod,backup_namespace,schedule) (velero_schedule_observation_timestamp_seconds == on(backup_namespace,schedule) group_left max by(backup_namespace,schedule) (velero_schedule_observation_timestamp_seconds))) == 1) and on(backup_namespace,schedule) (max by(backup_namespace,schedule) (velero_schedule_observation_timestamp_seconds) > time() - 900)",
          ),
          for: "5m",
          labels: { severity: "warning" },
        },
        {
          alert: "VeleroBackupFailed",
          annotations: {
            summary: escapePrometheusTemplate(
              "Velero scheduled backup {{ $labels.schedule }} failed",
            ),
            description: escapePrometheusTemplate(
              "The latest run of Velero schedule {{ $labels.schedule }} did not succeed, so recovery points for covered workloads are stale. Inspect the latest Backup CR and velero pod logs in the velero namespace.",
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
            summary: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} failing for over 12 hours",
            ),
            description: escapePrometheusTemplate(
              "Velero schedule {{ $labels.schedule }} has had no successful backup for over 12 hours, creating a growing recovery-point gap for cluster state. Investigate Velero controller logs, BackupStorageLocation connectivity, and failing volume snapshots immediately.",
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
            summary: escapePrometheusTemplate(
              `No successful ${scheduleConfig.backupType} Velero backup for {{ $labels.schedule }}`,
            ),
            description: escapePrometheusTemplate(
              `Velero schedule {{ $labels.schedule }} has not completed a successful backup within its expected ${scheduleConfig.monitoring.noBackupWindow} window, leaving recovery points outdated. Check the Schedule resource status, Velero pod logs, and BackupStorageLocation availability.`,
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
            summary: escapePrometheusTemplate(
              "High partial-failure rate on Velero schedule {{ $labels.schedule }}",
            ),
            description: escapePrometheusTemplate(
              "Over half ({{ $value | humanizePercentage }}) of recent backup attempts for schedule {{ $labels.schedule }} partially failed, meaning some resources or volumes are missing from backups. Run velero backup logs on the affected Backup CRs to identify failing items.",
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
            summary: "Velero restore failed",
            description:
              "One or more Velero restore operations failed in the last 15 minutes, leaving target workloads or volumes unrecovered. Inspect the Restore CR status and run velero restore logs to find the failing resource or snapshot.",
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
            summary: "Velero restore completed with partial failures",
            description:
              "One or more Velero restore operations partially failed in the last 15 minutes, leaving some Kubernetes resources or persistent volumes unrestored. Inspect the Restore CR with velero restore describe and velero restore logs to recover missing items.",
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
            description:
              "One or more Velero restore requests failed validation in the last 15 minutes and could not start. Inspect the Restore CR status for invalid parameters, missing backups, or unavailable storage locations.",
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
            description:
              "Velero recorded volume snapshot failures in the last 15 minutes, leaving persistent volume data out of recent backups. Check Velero pod logs and ZFS/CSI snapshotter status for the failing volume.",
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
            summary: "Velero CSI volume snapshot failed",
            description:
              "Velero recorded CSI snapshot failures in the last 15 minutes, preventing persistent volumes from being backed up cleanly. Check VolumeSnapshot CRs, CSI snapshot-controller logs, and OpenEBS ZFS-LocalPV driver health.",
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
            summary: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} failed with snapshot and item errors",
            ),
            description: escapePrometheusTemplate(
              "Velero schedule {{ $labels.schedule }} experienced both volume snapshot failures and backup item errors in the last 15 minutes, leaving volume backups incomplete. Inspect the failing Backup CR logs and check whether oversized or transient PVCs need backup exclusions.",
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
            summary: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} took longer than 60 minutes",
            ),
            description: escapePrometheusTemplate(
              '{{ $value | printf "%.0f" }} Velero {{ $labels.schedule }} backup(s) in the last 24 hours took longer than 60 minutes, risking schedule overlap and slow recovery uploads. Check backup logs for slow volume uploads or large PVCs that should be excluded.',
            ),
          },
          // Velero exports the duration only as a histogram. Backups that
          // finished but not within the 3600s bucket each took over 60
          // minutes; a mean would hide one slow run among fast ones. The 0.5
          // threshold absorbs increase() extrapolation.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum by (schedule) (increase(velero_backup_duration_seconds_count[1d]))
- sum by (schedule) (increase(velero_backup_duration_seconds_bucket{le="3600.0"}[1d]))
> 0.5`,
          ),
          for: "5m",
          labels: {
            severity: "info",
            namespace: "velero",
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
            description: escapePrometheusTemplate(
              'Velero recorded {{ $value | printf "%.0f" }} backup validation failure(s) in the last 6 hours, preventing scheduled or manual backups from running. Check Backup CR validation errors and BackupStorageLocation status in the velero namespace.',
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
            summary: "Velero backups are completing with warnings",
            description:
              "Velero backups logged warnings in the last 15 minutes, which may indicate skipped resources, hook issues, or deprecated APIs. Run velero backup describe on recent backups to review the warnings.",
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
            summary: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} reported item errors",
            ),
            description: escapePrometheusTemplate(
              'The latest backup for Velero schedule {{ $labels.schedule }} recorded {{ $value | printf "%.0f" }} item error(s), leaving specific cluster resources or volumes unbacked up. Run velero backup logs on the latest Backup CR to inspect the failing items.',
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
            summary: escapePrometheusTemplate(
              "High item error rate on Velero backup {{ $labels.schedule }}",
            ),
            description: escapePrometheusTemplate(
              "Velero schedule {{ $labels.schedule }} failed to back up {{ $value | humanizePercentage }} of its target items, degrading backup completeness. Inspect Velero backup logs for storage, permission, or volume-snapshot failures.",
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
            summary: "Velero expired-backup deletion is failing",
            description:
              "Velero failed to delete one or more expired backups in the last 30 minutes, which can leak object storage and local ZFS snapshots over time. Check DeleteBackupRequest CRs, Velero controller logs, and S3/Backblaze storage permissions.",
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
    getVeleroOrphanBackupCrRuleGroup(),
  ];
}

// Detection layer for orphan ZFSBackup CRs (parent Velero Backup gone, CR
// left behind), populated by the same velero-orphan-audit daily run. Only the
// CRs older than the 24h fence count, so normal TTL-expiry reaping (minutes)
// never trips these. Audit freshness is already covered by
// VeleroOrphanAuditNotRunning in the snapshot group.
function getVeleroOrphanBackupCrRuleGroup(): PrometheusRuleSpecGroups {
  return {
    name: "velero-orphan-backup-crs",
    rules: [
      {
        alert: "VeleroOrphanBackupCRs",
        annotations: {
          summary: "Orphaned Velero backup records detected",
          description: escapePrometheusTemplate(
            '{{ $value | printf "%.0f" }} ZFSBackup custom resource(s) older than 24 hours have no matching live Velero Backup CR, adding unpruned state to etcd. Run the CR-prune procedure in packages/temporal/runbooks/velero-orphan-snapshot-remediation.md.',
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "velero_orphan_backup_crs_total > 0",
        ),
        for: "24h",
        labels: {
          severity: "warning",
        },
      },
      {
        alert: "VeleroOrphanBackupCRsExcessive",
        annotations: {
          summary: "Orphaned Velero backup records are piling up",
          description: escapePrometheusTemplate(
            '{{ $value | printf "%.0f" }} orphaned ZFSBackup custom resources have accumulated cluster-wide, straining etcd and API server listings. Prune the orphaned CRs using packages/temporal/runbooks/velero-orphan-snapshot-remediation.md and investigate why TTL expiry stopped reaping them.',
          ),
        },
        // 100 CRs is ~2 full backup sets (~48 volumes each); the 2026-09 incident reached 1,797.
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "velero_orphan_backup_crs_total > 100",
        ),
        for: "24h",
        labels: {
          severity: "warning",
        },
      },
    ],
  };
}

// Detection layer for the Velero orphan-snapshot pathology, populated by the
// velero-orphan-audit Temporal workflow's daily run.
function getVeleroOrphanSnapshotRuleGroup(): PrometheusRuleSpecGroups {
  return {
    name: "velero-orphan-snapshots",
    rules: [
      {
        alert: "VeleroOrphanLocalSnapshots",
        annotations: {
          summary: "Orphaned Velero local ZFS snapshots detected",
          description: escapePrometheusTemplate(
            '{{ $value | printf "%.0f" }} local ZFS snapshot(s) have no matching live Velero Backup CR, pinning deleted blocks on ZFS pools. Run packages/temporal/runbooks/velero-orphan-snapshot-remediation.md to verify and prune the orphaned snapshots.',
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
          summary: "Orphaned Velero ZFS snapshots consuming over 1 GiB",
          description: escapePrometheusTemplate(
            "Orphaned local ZFS snapshots left behind by Velero are retaining {{ $value | humanize1024 }}B of pool space cluster-wide. Run packages/temporal/runbooks/velero-orphan-snapshot-remediation.md to reclaim disk space.",
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
          summary: "ZFS dataset has too many backup snapshots",
          description: escapePrometheusTemplate(
            'ZFS dataset {{ $labels.dataset }} on {{ $labels.node }} has {{ $value | printf "%.0f" }} Velero-managed snapshots, retaining old blocks and risking pool space exhaustion. Check for stalled snapshot deletions or orphaned snapshots and follow packages/temporal/runbooks/velero-orphan-snapshot-remediation.md.',
          ),
        },
        // Backstop: catches managed accumulation independently of orphan classification
        // (manual recovery snapshots are excluded). Expected max is ~26 (sum of schedule
        // retention slots); 35 adds ~35% headroom for transient overlap.
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "max by (node, dataset) (velero_managed_snapshot_count) > 35",
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
            "Velero orphan-snapshot audit workflow has not succeeded in 36h",
          description:
            "The daily velero-orphan-audit Temporal workflow has not recorded a successful run in over 36 hours, leaving orphan snapshot and ZFSBackup CR metrics stale. Check the schedule and recent workflow executions in the Temporal UI and worker logs.",
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
