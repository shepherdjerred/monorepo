import { Counter, Gauge, Histogram } from "prom-client";
import { register } from "./metrics.ts";

// ---------------------------------------------------------------------------
// ddns-sync workflow metrics (temporal-infra-worker)
// ---------------------------------------------------------------------------

export const temporalDdnsLastSuccessTimestampSeconds = new Gauge({
  name: "temporal_ddns_last_success_timestamp_seconds",
  help: "Unix timestamp of the last successful DDNS reconciliation for a hostname target",
  labelNames: ["target"] as const,
  registers: [register],
});

export const temporalDdnsUpdatesTotal = new Counter({
  name: "temporal_ddns_updates_total",
  help: "DDNS target reconciliation outcomes by target, action (unchanged | updated | failed), and outcome",
  labelNames: ["target", "action", "outcome"] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// git-backup-daily workflow metrics (temporal-repo-worker)
// ---------------------------------------------------------------------------

export const gitBackupLastSuccessTimestampSeconds = new Gauge({
  name: "git_backup_last_success_timestamp_seconds",
  help: "Unix timestamp of the last fully successful daily Git backup run",
  registers: [register],
});

export const gitBackupReposDiscovered = new Gauge({
  name: "git_backup_repos_discovered",
  help: "Number of GitHub repositories discovered in the latest Git backup run",
  registers: [register],
});

export const gitBackupRepoSuccess = new Gauge({
  name: "git_backup_repo_success",
  help: "Whether the latest Git backup succeeded (1) or failed (0) for each discovered repository",
  labelNames: ["owner", "repository"] as const,
  registers: [register],
});

export const gitBackupDurationSeconds = new Histogram({
  name: "git_backup_duration_seconds",
  help: "Wall-clock duration of daily Git backup runs in seconds",
  buckets: [10, 30, 60, 180, 300, 600, 1200, 1800, 3600, 7200],
  registers: [register],
});
