import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getGitckupRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    // Gitckup job monitoring (scheduled daily at 02:00)
    {
      name: "gitckup-jobs",
      rules: [
        {
          alert: "GitckupJobFailed",
          annotations: {
            summary: "Gitckup backup job failed",
            description: escapePrometheusTemplate(
              'More Gitckup backup jobs started ({{ $value | printf "%.0f" }}) than completed in the last 25 hours, indicating a failed or crashed backup run and leaving recent Git changes unbacked up. Check the gitckup pod logs and job status.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum(increase(gickup_jobs_started[25h])) > sum(increase(gickup_jobs_complete[25h]))",
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "GitckupJobNotRunning",
          annotations: {
            summary: "Gitckup daily backup job has not completed in 25 hours",
            description:
              "Gitckup has not completed a backup run in the last 25 hours, leaving recent repository commits unbacked up. Check whether the gitckup pod or schedule is failing and inspect gitckup logs.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum(increase(gickup_jobs_complete[25h])) == 0",
          ),
          for: "30m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "GitckupRepoDiscoveryFailed",
          annotations: {
            summary: "Gitckup discovered zero repositories to back up",
            description:
              "Gitckup discovered zero repositories during its latest run, meaning no Git repositories are being backed up. Check the configured GitHub/GitLab API tokens, token expiration, and network connectivity in gitckup logs.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "gickup_repos_discovered == 0",
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "GitckupSourcesIncomplete",
          annotations: {
            summary:
              "Gitckup failed to read from all configured backup sources",
            description: escapePrometheusTemplate(
              '{{ $value | printf "%.0f" }} configured Gitckup source(s) failed to complete during backup, leaving repositories from those forges unprotected. Check gitckup logs for source API errors, rate limits, or expired credentials.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "gickup_sources - gickup_sources_complete > 0",
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "GitckupDestinationsIncomplete",
          annotations: {
            summary: "Gitckup failed to write to all backup destinations",
            description: escapePrometheusTemplate(
              '{{ $value | printf "%.0f" }} configured Gitckup destination(s) failed to complete during backup, leaving repository mirrors or archives incomplete. Check gitckup logs for destination storage space, credentials, or connectivity errors.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "gickup_destinations - gickup_destinations_complete > 0",
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    // Gitckup performance monitoring
    {
      name: "gitckup-performance",
      rules: [
        {
          alert: "GitckupJobTooSlow",
          annotations: {
            summary: "Gitckup backup job average duration exceeds 4 hours",
            description: escapePrometheusTemplate(
              "Gitckup backup jobs are averaging {{ $value | humanizeDuration }} (over 4 hours), risking overlap or API rate-limit exhaustion. Check gitckup logs for slow or oversized repositories, network throttling, or destination storage latency.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "gickup_job_duration_sum / gickup_job_duration_count > 4 * 3600",
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "GitckupJobStuck",
          annotations: {
            summary: "Gitckup backup job appears stuck (average over 8 hours)",
            description: escapePrometheusTemplate(
              "Gitckup backup job average duration has reached {{ $value | humanizeDuration }} (over 8 hours), indicating hung clone/push operations and stalled backups. Inspect the running gitckup pod logs and restart the pod if a Git transfer is wedged.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "gickup_job_duration_sum / gickup_job_duration_count > 8 * 3600",
          ),
          for: "30m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
    // Gitckup success monitoring
    {
      name: "gitckup-success",
      rules: [
        {
          alert: "GitckupRepositoryBackupFailed",
          annotations: {
            summary: escapePrometheusTemplate(
              "Gitckup backup failed for {{ $labels.owner }}/{{ $labels.repository }}",
            ),
            description: escapePrometheusTemplate(
              "Gitckup failed to back up {{ $labels.hoster }}/{{ $labels.owner }}/{{ $labels.repository }}, leaving recent commits for this repository unprotected. Check repository access permissions and inspect the latest gitckup run logs for clone or push errors.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "gickup_repo_success == 0",
          ),
          // Allow the normal daily run to finish before reporting its outcome.
          for: "2h",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "GitckupRepoSuccessLow",
          annotations: {
            summary: "Gitckup repository backup success rate is below 95%",
            description: escapePrometheusTemplate(
              'Only {{ $value | printf "%.1f" }}% of discovered repositories were backed up cleanly in the latest Gitckup run. Check firing GitckupRepositoryBackupFailed alerts and gitckup logs for auth, timeout, or storage errors.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(count(gickup_repo_success == 1) / gickup_repos_discovered) * 100 < 95 and gickup_repos_discovered > 0",
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "GitckupNoReposBackedUp",
          annotations: {
            summary: "Gitckup failed to back up any discovered repositories",
            description:
              "Gitckup discovered repositories but backed up zero of them successfully in the latest run, leaving all Git backups stale. Check destination storage availability, credentials, and gitckup pod logs immediately.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "count(gickup_repo_success == 1) == 0 and gickup_repos_discovered > 0",
          ),
          for: "10m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
  ];
}
