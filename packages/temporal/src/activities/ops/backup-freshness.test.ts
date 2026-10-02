import { describe, expect, test } from "vitest";
import type { VeleroScheduleStatus } from "@shepherdjerred/ops-clients/kubernetes.ts";
import { backupFreshnessSignals } from "./backup-freshness.ts";

const now = new Date("2026-10-01T12:00:00Z");
const schedule: VeleroScheduleStatus = {
  name: "monthly",
  namespace: "velero",
  createdAt: "2026-07-01T00:00:00Z",
  cronSchedule: "0 3 1 * *",
  paused: false,
  maxAgeSeconds: 44 * 86_400,
  alertForSeconds: 300,
  alertSeverity: "warning",
};
function signals(schedules: VeleroScheduleStatus[], age?: number) {
  return backupFreshnessSignals({
    now,
    schedules,
    seaweedfs: [
      { metric: { cadence: "daily" }, value: 3600 },
      { metric: { cadence: "six-hourly" }, value: 3600 },
    ],
    velero:
      age === undefined
        ? []
        : [{ metric: { schedule: "monthly" }, value: age }],
  });
}
describe("backup owner cadence", () => {
  test("a monthly backup does not fail a universal daily threshold", () => {
    expect(signals([schedule], 30 * 86_400)).toEqual([]);
    expect(signals([schedule], 44 * 86_400 + 301)[0]).toMatchObject({
      severity: "warning",
      attributes: { maxAgeSeconds: 44 * 86_400, alertForSeconds: 300 },
    });
  });
  test("missing telemetry is unknown, and initial grace is explicit", () => {
    expect(
      signals([{ ...schedule, createdAt: now.toISOString() }])[0],
    ).toMatchObject({
      severity: "unknown",
      attributes: { initialWindow: true },
    });
    expect(signals([schedule])[0]).toMatchObject({
      severity: "unknown",
      attributes: { initialWindow: false },
    });
  });
  test("paused schedules are informational even with old evidence", () => {
    expect(
      signals([{ ...schedule, paused: true }], 99 * 86_400)[0],
    ).toMatchObject({ kind: "backup-paused", severity: "info" });
  });
  test("an empty inventory and unmatched metric do not synthesize health", () => {
    expect(signals([], 3600)[0]?.severity).toBe("unknown");
    expect(() => signals([schedule, schedule], 3600)).toThrow(/Duplicate/);
  });
});
