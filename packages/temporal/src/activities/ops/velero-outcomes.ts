import type {
  VeleroBackupStatus,
  VeleroScheduleStatus,
} from "@shepherdjerred/ops-clients/kubernetes.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { logsLink } from "./ops-links.ts";

const FAILED = new Set(["Failed", "FailedValidation", "PartiallyFailed"]);

function executionTimestamp(
  backup: VeleroBackupStatus,
  schedule: string,
): string {
  if (backup.startedAt !== undefined) return backup.startedAt;
  if (backup.completedAt !== undefined) return backup.completedAt;

  // FailedValidation never starts. Velero's Schedule.TimestampedName preserves
  // the original scheduled occurrence even if Kubernetes recreates the CR.
  const prefix = `${schedule}-`;
  const stamp = backup.name.slice(prefix.length);
  if (!backup.name.startsWith(prefix) || !/^\d{14}$/.test(stamp)) {
    throw new Error(
      `Velero backup ${backup.name} has no stable execution timestamp`,
    );
  }
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}.000Z`;
  const timestamp = Date.parse(iso);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== iso
  ) {
    throw new Error(
      `Velero backup ${backup.name} has an invalid scheduled timestamp`,
    );
  }
  return iso;
}

/** Read persisted CR outcomes, including controller-startup aborts that bypass counters. */
export function veleroOutcomes(
  backups: readonly VeleroBackupStatus[],
  schedules: readonly VeleroScheduleStatus[],
) {
  const signals: SignalInput[] = [];
  const observations: {
    namespace: string;
    schedule: string;
    failed: boolean | undefined;
  }[] = [];
  for (const schedule of schedules) {
    const terminal = backups
      .filter(
        (backup) =>
          backup.namespace === schedule.namespace &&
          backup.schedule === schedule.name &&
          (backup.phase === "Completed" ||
            (backup.phase !== undefined && FAILED.has(backup.phase))),
      )
      .map((backup) => ({
        backup,
        executionAt: executionTimestamp(backup, schedule.name),
      }))
      .toSorted(
        (left, right) =>
          Date.parse(right.executionAt) - Date.parse(left.executionAt) ||
          right.backup.name.localeCompare(left.backup.name),
      )[0];
    const failed =
      terminal === undefined
        ? undefined
        : terminal.backup.phase !== "Completed";
    observations.push({
      namespace: schedule.namespace,
      schedule: schedule.name,
      failed,
    });
    if (
      terminal?.backup.phase === undefined ||
      !FAILED.has(terminal.backup.phase)
    )
      continue;
    signals.push({
      id: `maintenance:velero-outcome:${schedule.namespace}:${schedule.name}`,
      source: "maintenance",
      section: "maintenance",
      kind: "backup-failure",
      severity: "warning",
      needsMe: true,
      title: `Velero ${schedule.name}: latest terminal backup ${terminal.backup.phase}`,
      detail:
        "Read from the persisted Backup resource. A running successor does not clear a failed or partial backup; a later completed backup does.",
      since: terminal.backup.completedAt ?? terminal.executionAt,
      attributes: {
        namespace: schedule.namespace,
        schedule: schedule.name,
        backupName: terminal.backup.name,
        phase: terminal.backup.phase,
      },
      links: [logsLink(schedule.namespace)],
    });
  }
  return { signals, observations };
}
