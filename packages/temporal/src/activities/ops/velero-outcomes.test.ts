import { describe, expect, test } from "vitest";
import type {
  VeleroBackupStatus,
  VeleroScheduleStatus,
} from "@shepherdjerred/ops-clients/kubernetes.ts";
import { veleroOutcomes } from "./velero-outcomes.ts";

const schedule: VeleroScheduleStatus = {
  name: "daily",
  namespace: "velero",
  createdAt: "2026-09-01T00:00:00Z",
  cronSchedule: "0 2 * * *",
  paused: false,
  maxAgeSeconds: 122_400,
  alertForSeconds: 300,
  alertSeverity: "warning",
};
function backup(
  phase: VeleroBackupStatus["phase"],
  day: number,
): VeleroBackupStatus {
  return {
    name: `daily-${String(day)}`,
    namespace: "velero",
    schedule: "daily",
    createdAt: `2026-10-0${String(day)}T02:00:00Z`,
    completedAt: undefined,
    phase,
  };
}

describe("persisted Velero outcomes", () => {
  test.each(["Failed", "FailedValidation", "PartiallyFailed"] as const)(
    "%s survives a counter reset and a running successor",
    (phase) => {
      const result = veleroOutcomes(
        [backup("Completed", 1), backup(phase, 2), backup("InProgress", 3)],
        [schedule],
      );
      expect(result.signals).toMatchObject([
        {
          severity: "warning",
          needsMe: true,
          attributes: { backupName: "daily-2", phase },
        },
      ]);
      expect(result.observations).toEqual([
        { namespace: "velero", schedule: "daily", failed: true },
      ]);
    },
  );
  test("a later completed backup establishes recovery, independent of inventory order", () => {
    expect(
      veleroOutcomes([backup("Completed", 3), backup("Failed", 2)], [schedule]),
    ).toEqual({
      signals: [],
      observations: [{ namespace: "velero", schedule: "daily", failed: false }],
    });
  });
  test("an absent terminal outcome remains unknown rather than publishing success", () => {
    expect(
      veleroOutcomes(
        [backup(undefined, 1), backup("InProgress", 2)],
        [schedule],
      ),
    ).toEqual({
      signals: [],
      observations: [
        { namespace: "velero", schedule: "daily", failed: undefined },
      ],
    });
  });
  test("another namespace or a manual backup cannot overwrite a scheduled outcome", () => {
    const result = veleroOutcomes(
      [
        backup("Failed", 1),
        { ...backup("Completed", 2), namespace: "other" },
        { ...backup("Completed", 3), schedule: undefined },
      ],
      [schedule],
    );
    expect(result.signals).toHaveLength(1);
    expect(result.observations[0]?.failed).toBe(true);
  });
});
