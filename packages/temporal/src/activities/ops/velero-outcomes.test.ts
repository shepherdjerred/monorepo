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
    name: `daily-2026100${String(day)}020000`,
    namespace: "velero",
    schedule: "daily",
    createdAt: `2026-10-0${String(day)}T02:00:00Z`,
    startedAt:
      phase === "FailedValidation"
        ? undefined
        : `2026-10-0${String(day)}T02:00:00Z`,
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
          attributes: { backupName: "daily-20261002020000", phase },
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

  test("an old failure synced into a new CR cannot overwrite a later successful execution", () => {
    const oldFailure = {
      ...backup("Failed", 1),
      createdAt: "2026-10-09T02:00:00Z",
    };
    expect(
      veleroOutcomes([oldFailure, backup("Completed", 2)], [schedule]),
    ).toEqual({
      signals: [],
      observations: [{ namespace: "velero", schedule: "daily", failed: false }],
    });
  });

  test("an old success synced into a new CR cannot clear a later failed execution", () => {
    const oldSuccess = {
      ...backup("Completed", 1),
      createdAt: "2026-10-09T02:00:00Z",
    };
    const result = veleroOutcomes(
      [oldSuccess, backup("Failed", 2)],
      [schedule],
    );
    expect(result.observations[0]?.failed).toBe(true);
    expect(result.signals[0]).toMatchObject({
      since: "2026-10-02T02:00:00Z",
      attributes: { backupName: "daily-20261002020000" },
    });
  });

  test("never-started FailedValidation uses its immutable scheduled identity for ordering and since", () => {
    const validationFailure = {
      ...backup("FailedValidation", 2),
      createdAt: "2026-10-09T02:00:00Z",
    };
    const failed = veleroOutcomes(
      [backup("Completed", 1), validationFailure],
      [schedule],
    );
    expect(failed.signals[0]).toMatchObject({
      since: "2026-10-02T02:00:00.000Z",
    });
    expect(failed.observations[0]?.failed).toBe(true);
    expect(
      veleroOutcomes([validationFailure, backup("Completed", 3)], [schedule])
        .observations[0]?.failed,
    ).toBe(false);
  });

  test("a persisted completion timestamp orders a terminal backup whose start was not recorded", () => {
    const failure = {
      ...backup("Failed", 2),
      startedAt: undefined,
      completedAt: "2026-10-02T02:05:00Z",
      name: "explicitly-labeled-backup",
    };
    expect(
      veleroOutcomes([failure, backup("Completed", 1)], [schedule]).signals[0]
        ?.since,
    ).toBe(failure.completedAt);
  });

  test("equal execution timestamps have a deterministic identity tie-break independent of API order", () => {
    const failure = backup("Failed", 2);
    const success = { ...backup("Completed", 1), startedAt: failure.startedAt };
    expect(veleroOutcomes([failure, success], [schedule])).toEqual(
      veleroOutcomes([success, failure], [schedule]),
    );
    expect(
      veleroOutcomes([success, failure], [schedule]).observations[0]?.failed,
    ).toBe(true);
  });

  test.each([
    "custom-name",
    "daily-20260230020000",
    "daily-20261002020099",
    "another-schedule-20261002020000",
  ])(
    "unknown or invalid never-started identity %s fails rather than manufacturing recency",
    (name) => {
      expect(() =>
        veleroOutcomes(
          [{ ...backup("FailedValidation", 2), name }],
          [schedule],
        ),
      ).toThrow(/timestamp/);
    },
  );
});
