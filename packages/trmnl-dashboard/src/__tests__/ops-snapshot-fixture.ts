import { assembleSnapshot } from "@shepherdjerred/ops-model/assemble.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import {
  SOURCE_IDS,
  type Metric,
  type SectionId,
  type SignalInput,
  type Snapshot,
  type SourceId,
  type SourceStatus,
} from "@shepherdjerred/ops-model/snapshot.ts";

type SectionMetric = Metric & { section: SectionId };

function metric(
  section: SectionId,
  id: string,
  value: number | null,
  overrides: Partial<Metric> = {},
): SectionMetric {
  return {
    section,
    id,
    label: id,
    value,
    unit: "count",
    severity: "ok",
    source: "kubernetes",
    ...overrides,
  };
}

export const HOMELAB_METRICS: readonly SectionMetric[] = [
  metric("alerts", METRIC_IDS.alertsFiring, 3, { source: "alerts" }),
  metric("alerts", METRIC_IDS.alertsCritical, 1, {
    source: "alerts",
    severity: "error",
  }),
  metric("alerts", METRIC_IDS.alertsWarning, 1, {
    source: "alerts",
    severity: "warning",
  }),
  metric("platform", METRIC_IDS.nodesReady, 2),
  metric("platform", METRIC_IDS.nodesTotal, 2),
  metric("platform", METRIC_IDS.podsUnhealthy, 0),
  metric("platform", METRIC_IDS.cpuUsedRatio, 0.234, { unit: "ratio" }),
  metric("platform", METRIC_IDS.memoryUsedRatio, 0.612, { unit: "ratio" }),
  metric("errors", METRIC_IDS.bugsinkUnresolved, 3, {
    source: "bugsink",
    severity: "warning",
  }),
  metric("maintenance", METRIC_IDS.diskMaxUsedRatio, 0.84, {
    source: "maintenance",
    unit: "ratio",
    severity: "warning",
  }),
];

function bugsinkIssue(id: number, project: string): SignalInput {
  return {
    id: `bugsink:issue:${String(id)}`,
    source: "bugsink",
    section: "errors",
    kind: "error-issue",
    severity: "warning",
    needsMe: false,
    title: `${project}: TypeError: boom`,
    attributes: { project, events: 1, new: true },
  };
}

export const HOMELAB_SIGNALS: readonly SignalInput[] = [
  {
    id: "alerts:DiskFull",
    source: "alerts",
    section: "alerts",
    kind: "alert",
    severity: "error",
    needsMe: true,
    title: "Disk is nearly full",
    attributes: { alertname: "DiskFull", firingMinutes: 42 },
  },
  {
    id: "alerts:BackupAge",
    source: "alerts",
    section: "alerts",
    kind: "alert",
    severity: "warning",
    needsMe: false,
    title: "Nightly backup is running late",
    attributes: { alertname: "BackupAge", firingMinutes: 5 },
  },
  bugsinkIssue(1, "dashboard"),
  bugsinkIssue(2, "automation"),
  bugsinkIssue(3, "automation"),
  {
    id: "maintenance:filesystem:/var",
    source: "maintenance",
    section: "maintenance",
    kind: "filesystem",
    severity: "warning",
    needsMe: false,
    title: "/var is 84% full",
    attributes: { instance: "torvalds", mountpoint: "/var", usedRatio: 0.84 },
  },
  {
    id: "maintenance:zpool:tank",
    source: "maintenance",
    section: "maintenance",
    kind: "zpool",
    severity: "warning",
    needsMe: false,
    title: "tank is 81% full",
    attributes: { zpool: "tank", usedRatio: 0.812 },
  },
];

export function sources(
  observedAt: Date,
  failed: Partial<Record<SourceId, string>> = {},
): SourceStatus[] {
  return SOURCE_IDS.map((source) => {
    const error = failed[source];
    return {
      source,
      ok: error === undefined,
      observedAt: observedAt.toISOString(),
      durationMs: 10,
      ...(error === undefined ? {} : { error }),
    };
  });
}

export function homelabSnapshot(generatedAt: Date): Snapshot {
  return assembleSnapshot({
    generatedAt,
    sources: sources(generatedAt),
    signals: HOMELAB_SIGNALS,
    metrics: HOMELAB_METRICS,
  });
}
