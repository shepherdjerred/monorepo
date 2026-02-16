import type { PrometheusRuleSpecGroups } from "../../../../../generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "../../../../../generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared";

export function getGitckupRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    // Gitckup job monitoring
    {
      name: "gitckup-jobs",
      rules: [
        {
          alert: "GitckupJobFailed",
          annotations: {
            summary: "Gitckup backup job has failed",
            message: escapePrometheusTemplate(
              "Gitckup backup job has failed. {{ $value }} more jobs started than completed in the last 25 hours.",
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
            summary: "Gitckup backup job has not run as scheduled",
            message: escapePrometheusTemplate(
              "Gitckup backup job has not completed successfully in the last 25 hours. Expected to run daily at 2 AM.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("sum(increase(gickup_jobs_complete[25h])) == 0"),
          for: "30m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "GitckupRepoDiscoveryFailed",
          annotations: {
            summary: "Gitckup repository discovery has failed",
            message: escapePrometheusTemplate(
              "Gitckup failed to discover repositories. Check GitHub token and permissions.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("gickup_repos_discovered == 0"),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "GitckupSourcesIncomplete",
          annotations: {
            summary: "Gitckup sources backup incomplete",
            message: escapePrometheusTemplate(
              "Gitckup sources backup is incomplete. {{ $value }} sources failed to complete backup.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("gickup_sources - gickup_sources_complete > 0"),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "GitckupDestinationsIncomplete",
          annotations: {
            summary: "Gitckup destinations backup incomplete",
            message: escapePrometheusTemplate(
              "Gitckup destinations backup is incomplete. {{ $value }} destinations failed to complete backup.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("gickup_destinations - gickup_destinations_complete > 0"),
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
            summary: "Gitckup backup job is taking too long",
            message: escapePrometheusTemplate(
              "Gitckup backup job average duration is more than 4 hours. Current average: {{ $value | humanizeDuration }}",
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
            summary: "Gitckup backup job appears to be stuck",
            message: escapePrometheusTemplate(
              "Gitckup backup job average duration is more than 8 hours and may be stuck. Manual intervention required.",
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
          alert: "GitckupRepoSuccessLow",
          annotations: {
            summary: "Gitckup repository backup success rate is low",
            message: escapePrometheusTemplate(
              "Gitckup repository backup success rate is below 95%. Only {{ $value }}% of repositories were successfully backed up.",
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
            summary: "Gitckup has not backed up any repositories",
            message: escapePrometheusTemplate(
              "Gitckup has not successfully backed up any repositories in the last run.",
            ),
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
