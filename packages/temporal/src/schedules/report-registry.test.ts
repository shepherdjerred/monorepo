import { describe, expect, test } from "vitest";
import { TEMPORAL_REPORT_SCHEDULES } from "@shepherdjerred/ops-model/reports/schedule-catalog.ts";
import { SCHEDULES } from "#schedules/schedule-definitions.ts";
import {
  defaultReportGraceHours,
  REPORT_SCHEDULE_REGISTRY,
} from "#shared/reports/report-registry.ts";

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

  test("aligns with all 12 TEMPORAL_REPORT_SCHEDULES in ops-model", () => {
    expect(TEMPORAL_REPORT_SCHEDULES).toHaveLength(12);
    expect(REPORT_SCHEDULE_REGISTRY).toHaveLength(
      TEMPORAL_REPORT_SCHEDULES.length,
    );
    const byId = new Map(
      REPORT_SCHEDULE_REGISTRY.map((entry) => [entry.scheduleId, entry]),
    );
    for (const catalogSchedule of TEMPORAL_REPORT_SCHEDULES) {
      expect(byId.get(catalogSchedule.scheduleId)).toMatchObject({
        scheduleId: catalogSchedule.scheduleId,
        reportType: catalogSchedule.reportType,
        cadenceHours: catalogSchedule.cadenceHours,
        graceHours: catalogSchedule.graceHours,
      });
    }
  });

  test("anchors receipt enforcement to a rollout the schedule could meet", () => {
    // Four activations: the original receipt-capable worker, the weekly
    // scanner schedules rollout, the Hub catalog alignment rollout, and
    // git-backup-daily rollout.
    expect(
      new Set(
        REPORT_SCHEDULE_REGISTRY.map(
          (registration) => registration.receiptRequiredAfter,
        ),
      ),
    ).toEqual(
      new Set([
        "2026-08-11T23:52:18.000Z",
        "2026-09-01T00:00:00.000Z",
        "2026-11-23T00:00:00.000Z",
        "2026-11-25T00:00:00.000Z",
      ]),
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
    for (const scheduleId of [
      "main-vuln-scan-weekly",
      "link-rot-scan-weekly",
    ]) {
      const registration = REPORT_SCHEDULE_REGISTRY.find(
        (candidate) => candidate.scheduleId === scheduleId,
      );
      expect(registration?.receiptRequiredAfter).toBe(
        "2026-09-01T00:00:00.000Z",
      );
    }
    for (const scheduleId of [
      "the-storm-promotion-daily",
      "scout-lane-priors-weekly-refresh",
    ]) {
      const registration = REPORT_SCHEDULE_REGISTRY.find(
        (candidate) => candidate.scheduleId === scheduleId,
      );
      expect(registration?.receiptRequiredAfter).toBe(
        "2026-11-23T00:00:00.000Z",
      );
    }
  });
});
