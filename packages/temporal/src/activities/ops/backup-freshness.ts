import type { VeleroScheduleStatus } from "@shepherdjerred/ops-clients/kubernetes.ts";
import type { PrometheusSample } from "@shepherdjerred/ops-clients/prometheus.ts";
import { SEAWEEDFS_BACKUP_FRESHNESS } from "@shepherdjerred/ops-model/backup-policy.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { metricsLink } from "./ops-links.ts";

function ages(
  samples: readonly PrometheusSample[],
  labelName: string,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const sample of samples) {
    const name = sample.metric[labelName];
    if (
      name === undefined ||
      name === "" ||
      result.has(name) ||
      !Number.isFinite(sample.value)
    ) {
      throw new Error(
        `Invalid or duplicate backup freshness sample for ${labelName}`,
      );
    }
    result.set(name, sample.value);
  }
  return result;
}

function signal(input: {
  name: string;
  severity: Severity;
  ageSeconds: number | undefined;
  query: string;
  detail?: string;
}): SignalInput {
  const { name, severity, ageSeconds, query, detail } = input;
  return {
    id: `maintenance:backup:${name}`,
    source: "maintenance",
    section: "maintenance",
    kind: "backup",
    severity,
    needsMe: false,
    title:
      ageSeconds === undefined
        ? `${name}: no successful-backup evidence`
        : `${name} backup is ${String(Math.round(ageSeconds / 3600))}h old`,
    ...(detail === undefined ? {} : { detail }),
    attributes:
      ageSeconds === undefined
        ? {}
        : { ageHours: Math.round(ageSeconds / 3600) },
    links: [metricsLink("Backup freshness", query, "now-30d")],
  };
}

/** Cadence and grace come from their owners; no empty metric means healthy. */
function seaweedfsSignals(samples: readonly PrometheusSample[]): SignalInput[] {
  const signals: SignalInput[] = [];
  const seaweedfs = ages(samples, "cadence");
  for (const cadence of seaweedfs.keys()) {
    if (!(cadence in SEAWEEDFS_BACKUP_FRESHNESS))
      throw new Error(`Unknown SeaweedFS backup cadence ${cadence}`);
  }
  for (const [cadence, policy] of Object.entries(SEAWEEDFS_BACKUP_FRESHNESS)) {
    const age = seaweedfs.get(cadence);
    const severity: Severity =
      age === undefined
        ? "unknown"
        : age > policy.errorSeconds + policy.alertForSeconds
          ? "error"
          : age > policy.warningSeconds + policy.alertForSeconds
            ? "warning"
            : "ok";
    if (severity !== "ok")
      signals.push(
        signal({
          name: `SeaweedFS ${cadence}`,
          severity,
          ageSeconds: age,
          query: `seaweedfs_backup_last_success_timestamp_seconds{cadence=${JSON.stringify(cadence)}}`,
        }),
      );
  }
  return signals;
}

function veleroScheduleSignal(
  schedule: VeleroScheduleStatus,
  age: number | undefined,
  now: Date,
): SignalInput | undefined {
  const name = `Velero ${schedule.name}`;
  const query = `velero_backup_last_successful_timestamp{schedule=${JSON.stringify(schedule.name)}}`;
  if (schedule.paused) {
    return {
      ...signal({
        name,
        severity: "info",
        ageSeconds: age,
        query,
        detail:
          "Schedule is paused; freshness is not evaluated until it resumes.",
      }),
      title: `${name} schedule is paused`,
      kind: "backup-paused",
      attributes: { paused: true, cronSchedule: schedule.cronSchedule },
    };
  }
  const deadline = schedule.maxAgeSeconds + schedule.alertForSeconds;
  if (age === undefined) {
    const firstDeadline = new Date(
      Date.parse(schedule.createdAt) + deadline * 1000,
    );
    const withinGrace = now < firstDeadline;
    return {
      ...signal({
        name,
        severity: "unknown",
        ageSeconds: age,
        query,
        detail: withinGrace
          ? `New schedule is within its initial backup window, ending ${firstDeadline.toISOString()}; no completed backup has been observed yet.`
          : `Active schedule ${schedule.cronSchedule}; successful-backup telemetry is missing after its initial window. Created ${schedule.createdAt}.`,
      }),
      attributes: {
        cronSchedule: schedule.cronSchedule,
        initialWindow: withinGrace,
        deadlineAt: firstDeadline.toISOString(),
      },
    };
  }
  if (age <= deadline) return undefined;
  const severity =
    schedule.alertSeverity === "critical"
      ? "error"
      : schedule.alertSeverity === "warning"
        ? "warning"
        : "info";
  return {
    ...signal({ name, severity, ageSeconds: age, query }),
    attributes: {
      ageHours: Math.round(age / 3600),
      maxAgeSeconds: schedule.maxAgeSeconds,
      alertForSeconds: schedule.alertForSeconds,
      deadlineAt: new Date(
        now.getTime() - age * 1000 + deadline * 1000,
      ).toISOString(),
      cronSchedule: schedule.cronSchedule,
    },
  };
}

/** Cadence and grace come from their owners; no empty metric means healthy. */
export function backupFreshnessSignals(input: {
  seaweedfs: readonly PrometheusSample[];
  velero: readonly PrometheusSample[];
  schedules: readonly VeleroScheduleStatus[];
  now: Date;
}): SignalInput[] {
  const signals = seaweedfsSignals(input.seaweedfs);
  const velero = ages(input.velero, "schedule");
  if (input.schedules.length === 0)
    signals.push(
      signal({
        name: "Velero schedules",
        severity: "unknown",
        ageSeconds: undefined,
        query: 'velero_backup_last_successful_timestamp{schedule!=""}',
        detail: "No Velero Schedule inventory was returned.",
      }),
    );
  const names = new Set<string>();
  for (const schedule of input.schedules) {
    if (names.has(schedule.name))
      throw new Error(`Duplicate Velero Schedule ${schedule.name}`);
    names.add(schedule.name);
    const result = veleroScheduleSignal(
      schedule,
      velero.get(schedule.name),
      input.now,
    );
    if (result !== undefined) signals.push(result);
  }
  return signals;
}
