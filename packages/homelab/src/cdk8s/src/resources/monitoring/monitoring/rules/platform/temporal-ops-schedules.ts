import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

export const DDNS_SYNC_STALE_EXPR = [
  'absent_over_time(temporal_ddns_last_success_timestamp_seconds{target="ddns.sjer.red"}[30m])',
  'or absent_over_time(temporal_ddns_last_success_timestamp_seconds{target="ipv4.ddns.sjer.red"}[30m])',
  "or (time() - max by (target) (max_over_time(temporal_ddns_last_success_timestamp_seconds[30m])) > 1800)",
].join(" ");

export const DDNS_UPDATE_FAILING_EXPR =
  'sum by (target) (increase(temporal_ddns_updates_total{action="failed"}[30m])) >= 3';

export const GIT_BACKUP_STALE_EXPR =
  "absent_over_time(git_backup_last_success_timestamp_seconds[28h]) or (time() - max(max_over_time(git_backup_last_success_timestamp_seconds[28h])) > 28 * 3600)";

export const GIT_BACKUP_REPO_FAILED_EXPR =
  "max by (owner, repository) (git_backup_repo_success) == 0";

export function getTemporalOpsScheduleRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "temporal-ddns",
      rules: [
        {
          alert: "DdnsSyncStale",
          annotations: {
            summary: escapePrometheusTemplate(
              "Temporal DDNS sync for {{ $labels.target }} is stale",
            ),
            description: escapePrometheusTemplate(
              "Temporal DDNS reconciliation for {{ $labels.target }} has not recorded a successful check in over 30 minutes (six 5-minute intervals), risking stale dynamic DNS records after a public IP change. Check the ddns-sync schedule in the Temporal UI and inspect temporal-infra-worker logs.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            DDNS_SYNC_STALE_EXPR,
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "DdnsUpdateFailing",
          annotations: {
            summary: escapePrometheusTemplate(
              "Temporal DDNS updates are failing for {{ $labels.target }}",
            ),
            description: escapePrometheusTemplate(
              'Temporal DDNS reconciliation for {{ $labels.target }} failed {{ $value | printf "%.0f" }} times in the last 30 minutes. Verify CLOUDFLARE_DDNS_API_TOKEN_FILE permissions, Cloudflare API reachability, and temporal-infra-worker logs.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            DDNS_UPDATE_FAILING_EXPR,
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    {
      name: "temporal-git-backup",
      rules: [
        {
          alert: "GitBackupStale",
          annotations: {
            summary: "Daily Git repository backup is stale",
            description:
              "Temporal git-backup-daily has not completed a fully successful backup run in the last 28 hours, leaving recent repository commits and GitHub issues unarchived in SeaweedFS. Check the git-backup-daily schedule in the Temporal UI, Hub /reports, and temporal-repo-worker logs.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            GIT_BACKUP_STALE_EXPR,
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "GitBackupRepoFailed",
          annotations: {
            summary: escapePrometheusTemplate(
              "Git backup failed for {{ $labels.owner }}/{{ $labels.repository }}",
            ),
            description: escapePrometheusTemplate(
              "The latest daily Git backup run failed for {{ $labels.owner }}/{{ $labels.repository }}, leaving recent refs or issues for that repository unbacked up in SeaweedFS git-backups. Inspect Hub /reports and temporal-repo-worker logs for mirror or GitHub API errors.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            GIT_BACKUP_REPO_FAILED_EXPR,
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
