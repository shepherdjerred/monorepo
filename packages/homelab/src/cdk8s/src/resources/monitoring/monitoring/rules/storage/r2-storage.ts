import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

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
      name: "velero-r2-orphans",
      rules: [
        {
          alert: "VeleroZfsBackupChainIncomplete",
          annotations: {
            summary:
              "Retained offsite ZFS recovery points have missing ancestors",
            message:
              "A completed Backup CR does not establish recoverability. Inspect stream ancestry, seed full backups and prove isolated recovery before any orphan cleanup.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max by (bucket) (velero_r2_incomplete_chain_roots{container="temporal-infra-worker"} and on (namespace,pod,bucket) (velero_r2_audit_observation_timestamp_seconds{container="temporal-infra-worker"} == on (bucket) group_left max by (bucket) (velero_r2_audit_observation_timestamp_seconds{container="temporal-infra-worker"}))) > 0',
          ),
          for: "5m",
          labels: { severity: "critical" },
        },
        {
          alert: "VeleroR2OrphanPrefixes",
          annotations: {
            summary: "Velero orphan R2 backup prefixes detected",
            message: escapePrometheusTemplate(
              "Velero orphan R2 prefixes present: {{ $value }} prefix(es) under zfspv-incr/backups/ have no matching live Velero Backup CR or metadata. Run packages/temporal/runbooks/r2-capacity-remediation.md.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max by (bucket) (velero_orphan_r2_prefixes_total{container="temporal-infra-worker"} and on (namespace,pod,bucket) (velero_r2_audit_observation_timestamp_seconds{container="temporal-infra-worker"} == on (bucket) group_left max by (bucket) (velero_r2_audit_observation_timestamp_seconds{container="temporal-infra-worker"}))) > 0',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "VeleroR2OrphanBytesExcessive",
          annotations: {
            summary: "Velero orphan R2 prefixes consuming significant storage",
            message: escapePrometheusTemplate(
              "Velero orphan R2 prefixes consume {{ $value | humanize1024 }}B. Run the remediation runbook to reclaim space before the bucket approaches its limit.",
            ),
          },
          // 50 GiB ceiling — under two days of accumulation at the observed
          // September 2026 rate (~30 GiB/day with zero reclamation).
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max by (bucket) (velero_orphan_r2_bytes_total{container="temporal-infra-worker"} and on (namespace,pod,bucket) (velero_r2_audit_observation_timestamp_seconds{container="temporal-infra-worker"} == on (bucket) group_left max by (bucket) (velero_r2_audit_observation_timestamp_seconds{container="temporal-infra-worker"}))) > 50 * 1024 * 1024 * 1024',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "VeleroR2OrphanAuditNotRunning",
          annotations: {
            summary:
              "velero-r2-orphan-audit workflow has not run successfully recently",
            message: escapePrometheusTemplate(
              "No durably published R2 audit observation is newer than 36h, or its state is unavailable. Investigate the workflow and ConfigMap restoration.",
            ),
          },
          // Preserve the observation's original time across worker rollouts.
          // Missing state is unknown and must not look like a successful zero.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'time() - max by (bucket) (velero_r2_audit_observation_timestamp_seconds{container="temporal-infra-worker"}) > 36 * 60 * 60 or label_replace(absent(max(velero_r2_audit_observation_timestamp_seconds{container="temporal-infra-worker"})), "bucket", "homelab", "", "")',
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
