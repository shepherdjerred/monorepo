import { Gauge } from "prom-client";
import { register } from "./metrics.ts";

// Ops snapshot gauges. Each source activity resets its gauges before setting
// them so a label set that disappeared upstream (a merged PR author class, a
// deleted Bugsink project) does not linger. Labels are bounded: author
// classes and Renovate states are closed sets, and teams, projects, nodes,
// and Talos services are small homelab inventories.

export const githubPullRequestsOpen = new Gauge({
  name: "github_pull_requests_open",
  help: "Open monorepo pull requests by author class and draft state",
  labelNames: ["author_class", "draft"] as const,
  registers: [register],
});

export const githubPullRequestsMerged7d = new Gauge({
  name: "github_pull_requests_merged_7d",
  help: "Monorepo pull requests merged in the last 7 days by author class",
  labelNames: ["author_class"] as const,
  registers: [register],
});

export const githubPullRequestOldestOpenAgeSeconds = new Gauge({
  name: "github_pull_request_oldest_open_age_seconds",
  help: "Age of the oldest open non-draft monorepo pull request by author class",
  labelNames: ["author_class"] as const,
  registers: [register],
});

export const renovateUpdatesPending = new Gauge({
  name: "renovate_updates_pending",
  help: "Renovate updates by state: awaiting approval, pending checks, or open PR",
  labelNames: ["state"] as const,
  registers: [register],
});

export const linearIssuesOpen = new Gauge({
  name: "linear_issues_open",
  help: "Open Linear issues by team key and workflow state type",
  labelNames: ["team", "state_type"] as const,
  registers: [register],
});

export const bugsinkIssuesUnresolved = new Gauge({
  name: "bugsink_issues_unresolved",
  help: "Unresolved, unmuted Bugsink issues by project slug",
  labelNames: ["project"] as const,
  registers: [register],
});

export const talosNodeReady = new Gauge({
  name: "talos_node_ready",
  help: "Whether a Talos node reports ready in its machine status (1) or not (0)",
  labelNames: ["node"] as const,
  registers: [register],
});

export const talosServiceHealthy = new Gauge({
  name: "talos_service_healthy",
  help: "Whether a Talos service is running and not failing its health check",
  labelNames: ["node", "service"] as const,
  registers: [register],
});

export const opsSnapshotSourceLastSuccessTimestampSeconds = new Gauge({
  name: "ops_snapshot_source_last_success_timestamp_seconds",
  help: "Unix timestamp of the last successful ops snapshot collection per source",
  labelNames: ["source"] as const,
  registers: [register],
});

export const opsSnapshotPublishedTimestampSeconds = new Gauge({
  name: "ops_snapshot_published_timestamp_seconds",
  help: "Unix timestamp of the last ops snapshot accepted by the dashboard",
  registers: [register],
});
