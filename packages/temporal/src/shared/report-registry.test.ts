import { describe, expect, test } from "bun:test";
import { SCHEDULES } from "#schedules/schedule-definitions.ts";
import {
  defaultReportGraceHours,
  REPORT_SCHEDULE_REGISTRY,
} from "./report-registry.ts";

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
      expect(sourceIds.has(scheduleId)).toBeTrue();
    }
  });

  test("activates receipt enforcement from the deployed receipt-capable worker", () => {
    expect(
      new Set(
        REPORT_SCHEDULE_REGISTRY.map(
          (registration) => registration.receiptRequiredAfter,
        ),
      ),
    ).toEqual(new Set(["2026-08-11T23:52:18.000Z"]));
  });
});
