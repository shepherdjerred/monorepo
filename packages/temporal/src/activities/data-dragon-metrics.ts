import { metricMeter } from "@temporalio/activity";
import type { DataDragonUpdateMode } from "./data-dragon.ts";

export type DataDragonRunMetrics = {
  mode: DataDragonUpdateMode;
  outcome: "success" | "skipped" | "failed";
  reason: string;
  currentVersion: string;
  latestVersion: string;
  changedFiles?: number;
  durationSeconds?: number;
  prCreated?: boolean;
};

function metrics(): {
  runs: ReturnType<typeof metricMeter.createCounter>;
  prs: ReturnType<typeof metricMeter.createCounter>;
  duration: ReturnType<typeof metricMeter.createHistogram>;
  changedFiles: ReturnType<typeof metricMeter.createGauge>;
  versionInfo: ReturnType<typeof metricMeter.createGauge>;
  autoMergeFailures: ReturnType<typeof metricMeter.createCounter>;
} {
  return {
    runs: metricMeter.createCounter(
      "scout_data_dragon_runs",
      "1",
      "Scout Data Dragon updater runs",
    ),
    prs: metricMeter.createCounter(
      "scout_data_dragon_prs",
      "1",
      "Scout Data Dragon updater PRs opened",
    ),
    duration: metricMeter.createHistogram(
      "scout_data_dragon_duration",
      "float",
      "s",
      "Scout Data Dragon updater duration",
    ),
    changedFiles: metricMeter.createGauge(
      "scout_data_dragon_changed_files",
      "int",
      "1",
      "Scout Data Dragon updater changed files",
    ),
    versionInfo: metricMeter.createGauge(
      "scout_data_dragon_version_info",
      "int",
      "1",
      "Scout Data Dragon latest version info",
    ),
    autoMergeFailures: metricMeter.createCounter(
      "scout_data_dragon_auto_merge_failures",
      "1",
      "Scout Data Dragon PR auto-merge setup failures",
    ),
  };
}

export function recordRun(input: DataDragonRunMetrics): void {
  const meter = metrics();
  const baseTags = {
    mode: input.mode,
    outcome: input.outcome,
    reason: input.reason,
  };
  meter.runs.add(1, baseTags);
  meter.changedFiles.set(input.changedFiles ?? 0, {
    mode: input.mode,
    outcome: input.outcome,
  });
  meter.versionInfo.set(1, {
    current_version: input.currentVersion,
    latest_version: input.latestVersion,
  });
  if (input.durationSeconds !== undefined) {
    meter.duration.record(input.durationSeconds, {
      mode: input.mode,
      outcome: input.outcome,
    });
  }
  if (input.prCreated === true) {
    meter.prs.add(1, { mode: input.mode });
  }
}

/**
 * Records that a PR was opened but its auto-merge setup (`gh pr merge
 * --auto`) failed — the caller catches and logs this locally without
 * throwing, so it never reaches `recordRun`'s outcome="failed" path. Without
 * a dedicated signal, a PR can sit unmerged indefinitely with no page (this
 * is exactly what happened to PR #1856).
 */
export function recordAutoMergeFailure(mode: DataDragonUpdateMode): void {
  metrics().autoMergeFailures.add(1, { mode });
}
