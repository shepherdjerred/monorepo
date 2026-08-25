import { describe, expect, test } from "vitest";
import { SCHEDULES } from "#schedules/schedule-definitions.ts";
import {
  defaultReportGraceHours,
  REPORT_SCHEDULE_REGISTRY,
} from "#shared/report-registry.ts";

describe("report schedule registry", () => {
  test("uses the documented default grace periods", () => {
    expect(defaultReportGraceHours(1)).toBe(0.5);
    expect(defaultReportGraceHours(24)).toBe(2);
    expect(defaultReportGraceHours(48)).toBe(2);
    expect(defaultReportGraceHours(168)).toBe(6);
  });

  test("contains unique source-defined deployed schedules", () => {
    const registeredIds = REPORT_SCHEDULE_REGISTRY.map(
      (registration) => registration.scheduleId,
    );
    expect(new Set(registeredIds).size).toBe(registeredIds.length);
    const sourceIds = new Set(SCHEDULES.map((schedule) => schedule.id));
    for (const scheduleId of registeredIds) {
      expect(sourceIds.has(scheduleId)).toBe(true);
    }
  });

  test("anchors receipt enforcement to a rollout the schedule could meet", () => {
    // Two activations: the original receipt-capable worker, and the rollout of
    // the weekly scanner schedules added later.
    expect(
      new Set(
        REPORT_SCHEDULE_REGISTRY.map(
          (registration) => registration.receiptRequiredAfter,
        ),
      ),
    ).toEqual(
      new Set(["2026-08-11T23:52:18.000Z", "2026-09-01T00:00:00.000Z"]),
    );
  });

  test("a schedule never activates before a rollout it could not have met", () => {
    // Regression guard. Before its first receipt a schedule's pending window
    // is bounded at receiptRequiredAfter + cadence + grace, so inheriting an
    // older schedule's activation makes a brand-new weekly job report
    // `missing` and page TemporalReportHeartbeatStale for a full cadence
    // before it can run once. Each activation must leave room for at least one
    // full cadence after it.
    for (const registration of REPORT_SCHEDULE_REGISTRY) {
      const activation = Date.parse(registration.receiptRequiredAfter);
      expect(Number.isFinite(activation)).toBe(true);
      const pendingWindowHours =
        registration.cadenceHours + registration.graceHours;
      expect(pendingWindowHours).toBeGreaterThan(registration.cadenceHours);
    }
    for (const scheduleId of ["main-vuln-scan-weekly"]) {
      const registration = REPORT_SCHEDULE_REGISTRY.find(
        (candidate) => candidate.scheduleId === scheduleId,
      );
      expect(registration?.receiptRequiredAfter).toBe(
        "2026-09-01T00:00:00.000Z",
      );
    }
  });
});
