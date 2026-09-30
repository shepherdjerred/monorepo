import {
  applyFreshness,
  findMetric,
  findSection,
  type FreshSnapshot,
} from "@shepherdjerred/ops-model/assemble.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import type {
  Metric,
  Section,
  Signal,
  SourceId,
} from "@shepherdjerred/ops-model/snapshot.ts";
import type { AppConfig } from "../config.ts";
import { OpsSnapshotClient } from "../clients/ops.ts";
import { statusFromSeverity, worstStatus, type Status } from "../status.ts";
import { formatDisplayTime } from "../time.ts";
import type {
  AlertsSection,
  BugsinkSection,
  HardwareSection,
  HomelabPayload,
  KubernetesSection,
  StorageSection,
} from "../types.ts";

/** Sources behind the tiles on the homelab screen. */
const HOMELAB_SOURCES: ReadonlySet<SourceId> = new Set([
  "alerts",
  "kubernetes",
  "bugsink",
  "maintenance",
]);

export type HomelabClients = {
  ops: Pick<OpsSnapshotClient, "getSnapshot">;
};

export function createHomelabClients(config: AppConfig): HomelabClients {
  return { ops: new OpsSnapshotClient(config.opsDashboardUrl) };
}

export async function collectHomelabPayload(
  config: AppConfig,
  clients = createHomelabClients(config),
  now = new Date(),
): Promise<HomelabPayload> {
  let snapshot: FreshSnapshot;
  try {
    snapshot = applyFreshness(await clients.ops.getSnapshot(), now);
  } catch (error) {
    return unavailablePayload(config, now, errorMessage("Ops", error));
  }

  const alertsSection = findSection(snapshot, "alerts");
  const platform = findSection(snapshot, "platform");
  const maintenance = findSection(snapshot, "maintenance");
  const bugsink = mapBugsink(findSection(snapshot, "errors"));
  const kubernetes = mapKubernetes(platform);
  const storage = mapStorage(maintenance);
  const hardware = mapHardware(platform);
  const alerts = mapAlerts(alertsSection);
  const errors = snapshotErrors(snapshot);

  return {
    screen: "homelab",
    generated_at: snapshot.generatedAt,
    generated_time: formatDisplayTime(
      new Date(snapshot.generatedAt),
      config.displayTimeZone,
    ),
    status: worstStatus([
      bugsink.status,
      kubernetes.status,
      storage.status,
      hardware.status,
      alerts.status,
      errors.length > 0 ? "unknown" : "ok",
    ]),
    summary: [
      `${kubernetes.ready_nodes.toString()}/${kubernetes.total_nodes.toString()} nodes`,
      `${alerts.critical.toString()} critical alerts`,
      `${alerts.warning.toString()} warning alerts`,
      bugsink.status === "unknown"
        ? "Bugsink ERR"
        : `${bugsink.unresolved.toString()} Bugsink`,
      alerts.status === "unknown"
        ? "Alerts ERR"
        : `${alerts.open.toString()} open alerts`,
    ].join(" · "),
    bugsink,
    kubernetes,
    storage,
    hardware,
    alerts,
    errors,
  };
}

/** A count the source failed to produce renders as unknown, never as zero. */
function count(metric: Metric | undefined): number | null {
  return metric?.value ?? null;
}

function percent(metric: Metric | undefined): number | null {
  const value = metric?.value;
  return value == null ? null : Math.round(value * 1000) / 10;
}

function metricStatus(metric: Metric | undefined): Status {
  return metric?.value == null
    ? "unknown"
    : statusFromSeverity(metric.severity);
}

function mapBugsink(section: Section): BugsinkSection {
  const unresolved = findMetric(section, METRIC_IDS.bugsinkUnresolved);
  return {
    status: worstStatus([
      metricStatus(unresolved),
      statusFromSeverity(section.severity),
    ]),
    unresolved: count(unresolved) ?? 0,
    projects: issuesByProject(signalsOfKind(section, "error-issue")),
  };
}

/**
 * The snapshot lists recently seen issues, not per-project totals, so the
 * project table counts those listed issues.
 */
function issuesByProject(
  issues: readonly Signal[],
): BugsinkSection["projects"] {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const project = stringAttribute(issue, "project") ?? "unknown";
    counts.set(project, (counts.get(project) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, unresolved]) => ({ name, unresolved }))
    .toSorted((left, right) => right.unresolved - left.unresolved)
    .slice(0, 6);
}

function mapKubernetes(section: Section): KubernetesSection {
  const metrics = [
    findMetric(section, METRIC_IDS.nodesReady),
    findMetric(section, METRIC_IDS.nodesTotal),
    findMetric(section, METRIC_IDS.podsUnhealthy),
  ] as const;
  const [ready, total, unhealthy] = metrics;
  return {
    status: worstStatus(metrics.map((metric) => metricStatus(metric))),
    ready_nodes: count(ready) ?? 0,
    total_nodes: count(total) ?? 0,
    unhealthy_pods: count(unhealthy) ?? 0,
  };
}

function mapHardware(section: Section): HardwareSection {
  const cpu = findMetric(section, METRIC_IDS.cpuUsedRatio);
  const memory = findMetric(section, METRIC_IDS.memoryUsedRatio);
  return {
    status: worstStatus([metricStatus(cpu), metricStatus(memory)]),
    cpu_used_percent: percent(cpu),
    memory_used_percent: percent(memory),
  };
}

function mapStorage(section: Section): StorageSection {
  const disk = findMetric(section, METRIC_IDS.diskMaxUsedRatio);
  return {
    status: metricStatus(disk),
    max_disk_used_percent: percent(disk),
    // Disk signals exist only above the warning ratio: `filesystem` signals
    // carry `mountpoint`, `zpool` signals carry `zpool`.
    volumes: [
      ...signalsOfKind(section, "filesystem"),
      ...signalsOfKind(section, "zpool"),
    ]
      .map((signal) => {
        const ratio = numberAttribute(signal, "usedRatio");
        if (ratio === undefined) {
          throw new Error(`Disk signal ${signal.id} has no usedRatio`);
        }
        return {
          name:
            stringAttribute(signal, "mountpoint") ??
            stringAttribute(signal, "zpool") ??
            signal.title,
          used_percent: Math.round(ratio * 1000) / 10,
        };
      })
      .toSorted((left, right) => right.used_percent - left.used_percent)
      .slice(0, 6),
  };
}

function mapAlerts(section: Section): AlertsSection {
  const firing = findMetric(section, METRIC_IDS.alertsFiring);
  const critical = count(findMetric(section, METRIC_IDS.alertsCritical)) ?? 0;
  const warning = count(findMetric(section, METRIC_IDS.alertsWarning)) ?? 0;
  const open = count(firing) ?? 0;
  return {
    status: worstStatus([
      metricStatus(firing),
      statusFromSeverity(section.severity),
    ]),
    open,
    critical,
    warning,
    info: Math.max(0, open - critical - warning),
    recent: signalsOfKind(section, "alert")
      .slice(0, 6)
      .map((signal) => ({
        severity: signal.severity,
        alertname: stringAttribute(signal, "alertname") ?? signal.title,
        summary: signal.title,
      })),
  };
}

function snapshotErrors(snapshot: FreshSnapshot): string[] {
  const errors: string[] = [];
  if (snapshot.stale) {
    errors.push(
      `Ops snapshot is ${Math.round(snapshot.ageMs / 60_000).toString()} minutes old`,
    );
  }
  for (const source of snapshot.sources) {
    if (!source.ok && HOMELAB_SOURCES.has(source.source)) {
      errors.push(`${source.source}: ${source.error ?? "collection failed"}`);
    }
  }
  return errors;
}

function signalsOfKind(section: Section, kind: string): Signal[] {
  return section.signals.filter((signal) => signal.kind === kind);
}

function numberAttribute(signal: Signal, key: string): number | undefined {
  const value = signal.attributes[key];
  return typeof value === "number" ? value : undefined;
}

function stringAttribute(signal: Signal, key: string): string | undefined {
  const value = signal.attributes[key];
  return typeof value === "string" ? value : undefined;
}

function unavailablePayload(
  config: AppConfig,
  now: Date,
  error: string,
): HomelabPayload {
  return {
    screen: "homelab",
    generated_at: now.toISOString(),
    generated_time: formatDisplayTime(now, config.displayTimeZone),
    status: "unknown",
    summary: "Ops snapshot unavailable",
    bugsink: { status: "unknown", unresolved: 0, projects: [] },
    kubernetes: {
      status: "unknown",
      ready_nodes: 0,
      total_nodes: 0,
      unhealthy_pods: 0,
    },
    storage: { status: "unknown", max_disk_used_percent: null, volumes: [] },
    hardware: {
      status: "unknown",
      cpu_used_percent: null,
      memory_used_percent: null,
    },
    alerts: {
      status: "unknown",
      open: 0,
      critical: 0,
      warning: 0,
      info: 0,
      recent: [],
    },
    errors: [error],
  };
}

function errorMessage(area: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${area}: ${message}`;
}
