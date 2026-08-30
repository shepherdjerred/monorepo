import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getR2StorageRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "r2-storage",
      rules: [
        {
          alert: "R2StorageNearingLimit",
          annotations: {
            summary: "R2 storage approaching 1.5TB limit",
            message: escapePrometheusTemplate(
              "R2 bucket {{ $labels.bucket }} is at {{ $value | humanize1024 }}B (80% of 1.5TB limit)",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "cloudflare_r2_storage_bytes > 1200 * 1024 * 1024 * 1024",
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "R2StorageExceedingLimit",
          annotations: {
            summary: "R2 storage exceeding 1.5TB limit",
            message: escapePrometheusTemplate(
              "R2 bucket {{ $labels.bucket }} has exceeded 1.5TB: {{ $value | humanize1024 }}B",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "cloudflare_r2_storage_bytes > 1536 * 1024 * 1024 * 1024",
          ),
          for: "15m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "R2ExporterDown",
          annotations: {
            summary: "R2 exporter is not scraping successfully",
            message: escapePrometheusTemplate(
              "R2 exporter has not successfully scraped bucket {{ $labels.bucket }} metrics",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "cloudflare_r2_exporter_scrape_success == 0",
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    {
      name: "seaweedfs-offsite-backup",
      rules: [
        {
          alert: "SeaweedFSBackupCriticalStale",
          annotations: {
            summary: "Critical SeaweedFS backup is stale",
            message:
              "The six-hourly SeaweedFS off-site backup has not completed in eight hours.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'time() - max by (cadence) (seaweedfs_backup_last_success_timestamp_seconds{cadence="six-hourly"}) > 8 * 60 * 60',
          ),
          for: "5m",
          labels: { severity: "critical" },
        },
        {
          alert: "SeaweedFSBackupDailyLate",
          annotations: {
            summary: "Daily SeaweedFS backup is late",
            message:
              "The daily SeaweedFS off-site backup has not completed in 36 hours.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'time() - max by (cadence) (seaweedfs_backup_last_success_timestamp_seconds{cadence="daily"}) > 36 * 60 * 60',
          ),
          for: "5m",
          labels: { severity: "warning" },
        },
        {
          alert: "SeaweedFSBackupDailyStale",
          annotations: {
            summary: "Daily SeaweedFS backup is stale",
            message:
              "The daily SeaweedFS off-site backup has not completed in 48 hours.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'time() - max by (cadence) (seaweedfs_backup_last_success_timestamp_seconds{cadence="daily"}) > 48 * 60 * 60',
          ),
          for: "5m",
          labels: { severity: "critical" },
        },
        {
          alert: "SeaweedFSBackupIntegrityFailure",
          annotations: {
            summary: "SeaweedFS backup integrity verification failed",
            message:
              "A backup attempt failed during conditional copy, manifest validation, or checksum verification. Inspect the linked Temporal failure.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(seaweedfs_backup_verification_total{outcome="failure"}[15m]) > 0',
          ),
          labels: { severity: "critical" },
        },
        {
          alert: "SeaweedFSBackupCoverageDrift",
          annotations: {
            summary: "SeaweedFS backup policy does not classify every bucket",
            message:
              "At least one live SeaweedFS bucket has no explicit protected or excluded policy entry.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'seaweedfs_backup_coverage_buckets{problem="unclassified"} > 0',
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
        {
          alert: "SeaweedFSBackupCoverageDrift",
          annotations: {
            summary: "SeaweedFS backup coverage drift has persisted for a day",
            message:
              "A live SeaweedFS bucket has remained unclassified for 24 hours.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'seaweedfs_backup_coverage_buckets{problem="unclassified"} > 0',
          ),
          for: "24h",
          labels: { severity: "critical" },
        },
        {
          alert: "SeaweedFSBackupProtectedBucketMissing",
          annotations: {
            summary: "A protected SeaweedFS bucket is missing",
            message:
              "The source inventory does not contain every bucket marked protected by policy.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'seaweedfs_backup_coverage_buckets{problem="protected-missing"} > 0',
          ),
          for: "5m",
          labels: { severity: "critical" },
        },
        {
          alert: "SeaweedFSBackupRetentionShortfall",
          annotations: {
            summary: "SeaweedFS backup retention is below policy",
            message: escapePrometheusTemplate(
              "The warmed-up {{ $labels.tier }} retention tier has only {{ $value }} recovery points.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(seaweedfs_backup_retained_points{tier="sixHourly"} < 28 and on(tier) seaweedfs_backup_retention_warm == 1) or (seaweedfs_backup_retained_points{tier="daily"} < 30 and on(tier) seaweedfs_backup_retention_warm == 1) or (seaweedfs_backup_retained_points{tier="weekly"} < 8 and on(tier) seaweedfs_backup_retention_warm == 1) or (seaweedfs_backup_retained_points{tier="monthly"} < 12 and on(tier) seaweedfs_backup_retention_warm == 1)',
          ),
          for: "30m",
          labels: { severity: "warning" },
        },
        {
          alert: "SeaweedFSBackupGcCandidateStuck",
          annotations: {
            summary: "SeaweedFS backup GC candidate is stuck",
            message:
              "The oldest pending two-phase GC candidate set is more than 14 days old.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "time() - seaweedfs_backup_gc_oldest_candidate_timestamp_seconds > 14 * 24 * 60 * 60",
          ),
          for: "30m",
          labels: { severity: "warning" },
        },
        {
          alert: "SeaweedFSBackupGcRevalidationFailure",
          annotations: {
            summary: "SeaweedFS backup GC revalidation failed",
            message:
              "Garbage collection stopped because the complete retained protection set could not be rebuilt.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(seaweedfs_backup_gc_revalidation_failures_total[30m]) > 0",
          ),
          labels: { severity: "warning" },
        },
        {
          alert: "SeaweedFSBackupBucketLockDrift",
          annotations: {
            summary: "SeaweedFS backup R2 bucket lock drifted",
            message:
              "The objects/ and snapshots/ R2 prefixes must both retain a 30-day age lock.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'count(cloudflare_r2_bucket_lock_age_seconds{bucket="seaweedfs-backups",prefix=~"objects/|snapshots/"}) < 2 or min(cloudflare_r2_bucket_lock_age_seconds{bucket="seaweedfs-backups",prefix=~"objects/|snapshots/"}) < 2592000',
          ),
          for: "15m",
          labels: { severity: "critical" },
        },
        {
          alert: "SeaweedFSBackupCostProjectionHigh",
          annotations: {
            summary: "SeaweedFS backup R2 storage projects above $10 per month",
            message: escapePrometheusTemplate(
              'The current R2 backup footprint projects to ${{ $value | printf "%.2f" }}/month at Standard storage pricing.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'cloudflare_r2_storage_bytes{bucket="seaweedfs-backups"} / 1000000000 * 0.015 > 10',
          ),
          for: "1h",
          labels: { severity: "warning" },
        },
      ],
    },
  ];
}
