import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type {
  Metric,
  SectionId,
  SourceId,
} from "@shepherdjerred/ops-model/snapshot.ts";

import { metric, type FixtureMetric } from "#test-fixtures/ops-snapshot";

type Reading = {
  value: number | null;
  unit?: Metric["unit"];
  severity?: Severity;
};
type MetricRow = readonly [id: string, label: string, reading: Reading];

function reading(
  value: number,
  severity: Severity = "ok",
  unit: Metric["unit"] = "count",
): Reading {
  return { value, unit, severity };
}

function placed(
  section: SectionId,
  source: SourceId,
  rows: readonly MetricRow[],
): FixtureMetric[] {
  return rows.map(([id, label, value]) =>
    metric({ section, source }, id, label, value),
  );
}

export type VolumeReadings = {
  /** Severity of `alerts.firing`; today's collector leaves it at `ok`. */
  firing: Severity;
  /** Used ratio of the fullest quota window. */
  fullestQuota: number;
  renovatePending: number;
  aiMonthToDateUsd: number;
  aiProjectedUsd: number;
};

/** Every headline metric the collector emits, with its label. */
export function volumeMetrics(readings: VolumeReadings): FixtureMetric[] {
  const m = METRIC_IDS;
  return [
    ...placed("alerts", "alerts", [
      [m.alertsFiring, "Firing alerts", reading(15, readings.firing)],
      [m.alertsCritical, "Critical", reading(1, "error")],
      [m.alertsWarning, "Warning", reading(14, "warning")],
      [m.houseChoresOpen, "House chores open", reading(3, "ok")],
    ]),
    ...placed("platform", "kubernetes", [
      [m.nodesReady, "Nodes ready", reading(2)],
      [m.nodesTotal, "Nodes", reading(2)],
      [m.podsUnhealthy, "Unhealthy pods", reading(1)],
    ]),
    ...placed("platform", "argocd", [
      [m.argoAppsUnhealthy, "Unhealthy apps", reading(1)],
      [m.argoAppsOutOfSync, "Out of sync", reading(2)],
    ]),
    ...placed("platform", "maintenance", [
      [m.cpuUsedRatio, "CPU used", reading(0.46, "ok", "ratio")],
      [m.memoryUsedRatio, "Memory used", reading(0.81, "ok", "ratio")],
    ]),
    ...placed("delivery", "github", [
      [m.prsOpen, "Open PRs", reading(9)],
      [m.prsAwaitingMe, "Awaiting your review", reading(2, "info")],
      [m.prsMerged7d, "Merged (7d)", reading(64)],
      [
        m.prMedianHoursToMerge30d,
        "Median hours to merge (30d)",
        reading(3.4, "ok", "hours"),
      ],
    ]),
    ...placed("delivery", "renovate", [
      [m.renovatePending, "Pending updates", reading(readings.renovatePending)],
      [m.renovateAwaitingApproval, "Awaiting approval", reading(100, "info")],
    ]),
    ...placed("work", "tracker", [
      [m.trackerOpen, "Open issues", reading(212)],
      [m.trackerTriage, "In triage", reading(5, "info")],
    ]),
    ...placed("errors", "bugsink", [
      [m.bugsinkUnresolved, "Unresolved errors", reading(38)],
    ]),
    ...placed("product", "probes", [[m.probesDown, "Probes down", reading(0)]]),
    ...placed("product", "posthog", [
      [m.pageviews24h, "Pageviews (24h)", reading(9412)],
    ]),
    ...placed("ai", "ai", [
      [
        m.aiCostMonthToDateUsd,
        "API spend (MTD)",
        reading(readings.aiMonthToDateUsd, "ok", "usd"),
      ],
      [
        m.aiCostProjectedUsd,
        "Projected month",
        reading(readings.aiProjectedUsd, "warning", "usd"),
      ],
      [m.aiTokens24h, "Tokens (24h)", reading(412_800_000, "ok", "tokens")],
      [
        m.aiQuotaMaxUsedRatio,
        "Fullest quota window",
        reading(readings.fullestQuota, "error", "ratio"),
      ],
    ]),
    ...placed("maintenance", "maintenance", [
      [m.backupsFailed, "Failed backup schedules", reading(0)],
      [m.diskMaxUsedRatio, "Fullest disk", reading(0.84, "warning", "ratio")],
      [m.certificatesExpiringSoon, "Certificates expiring", reading(1)],
      [m.backupsStale, "Stale backups", reading(0)],
    ]),
    ...placed("maintenance", "temporal", [
      [m.schedulesFailed, "Scheduled workflows failing", reading(0)],
      [m.schedulesUnknown, "Schedule outcomes unknown", reading(0)],
      [m.schedulesPaused, "Paused schedules", reading(16, "info")],
    ]),
    ...placed("observability", "logs", [
      [m.logErrors1h, "Error log lines (1h)", reading(873)],
    ]),
    ...placed("observability", "traces", [
      [m.traceErrors1h, "Error traces (1h)", reading(27)],
      [m.slowTraces1h, "Traces > 5s (1h)", reading(20)],
    ]),
  ];
}
