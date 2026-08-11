import { describe, expect, test } from "bun:test";
import { evaluateFreshness } from "./report-freshness.ts";

const registration = {
  scheduleId: "daily-report",
  reportType: "daily-report",
  cadenceHours: 24,
  graceHours: 2,
};

describe("evaluateFreshness", () => {
  test("uses cadence plus the daily grace period", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    expect(
      evaluateFreshness({
        registration,
        now,
        acceptedAt: "2026-08-09T11:00:01.000Z",
        deployed: true,
        paused: false,
      }).status,
    ).toBe("fresh");
    expect(
      evaluateFreshness({
        registration,
        now,
        acceptedAt: "2026-08-09T09:59:59.000Z",
        deployed: true,
        paused: false,
      }).status,
    ).toBe("stale");
  });

  test("distinguishes missing receipts, schedules, and paused schedules", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    expect(
      evaluateFreshness({
        registration,
        now,
        acceptedAt: undefined,
        deployed: true,
        paused: false,
      }).status,
    ).toBe("missing");
    expect(
      evaluateFreshness({
        registration,
        now,
        acceptedAt: undefined,
        deployed: false,
        paused: false,
      }).status,
    ).toBe("schedule-missing");
    expect(
      evaluateFreshness({
        registration,
        now,
        acceptedAt: undefined,
        deployed: true,
        paused: true,
      }).status,
    ).toBe("schedule-paused");
  });
});
