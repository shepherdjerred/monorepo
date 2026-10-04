import type {
  VeleroBackupStatus,
  VeleroScheduleStatus,
} from "@shepherdjerred/ops-clients/kubernetes.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { logsLink } from "./ops-links.ts";

const FAILED = new Set(["Failed", "FailedValidation", "PartiallyFailed"]);

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
      .toSorted(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt),
      )[0];
    const failed =
      terminal === undefined ? undefined : terminal.phase !== "Completed";
    observations.push({
      namespace: schedule.namespace,
      schedule: schedule.name,
      failed,
    });
    if (terminal?.phase === undefined || !FAILED.has(terminal.phase)) continue;
    signals.push({
      id: `maintenance:velero-outcome:${schedule.namespace}:${schedule.name}`,
      source: "maintenance",
      section: "maintenance",
      kind: "backup-failure",
      severity: "warning",
      needsMe: true,
      title: `Velero ${schedule.name}: latest terminal backup ${terminal.phase}`,
      detail:
        "Read from the persisted Backup resource. A running successor does not clear a failed or partial backup; a later completed backup does.",
      since: terminal.completedAt ?? terminal.createdAt,
      attributes: {
        namespace: schedule.namespace,
        schedule: schedule.name,
        backupName: terminal.name,
        phase: terminal.phase,
      },
      links: [logsLink(schedule.namespace)],
    });
  }
  return { signals, observations };
}
