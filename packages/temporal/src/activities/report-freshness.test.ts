import { afterEach, describe, expect, test } from "bun:test";
import { reportFreshnessState } from "#observability/metrics-report.ts";
import {
  evaluateFreshness,
  freshnessDeploymentState,
  publishReportFreshnessMetrics,
} from "./report-freshness.ts";

const registration = {
  scheduleId: "daily-report",
  reportType: "daily-report",
  cadenceHours: 24,
  graceHours: 2,
  receiptRequiredAfter: "2026-08-01T00:00:00.000Z",
};

afterEach(() => {
  reportFreshnessState.reset();
});

describe("evaluateFreshness", () => {
  test("uses cadence plus the daily grace period", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    expect(
      evaluateFreshness({
        registration,
        now,
        acceptedAt: "2026-08-09T11:00:01.000Z",
        lastActionTakenAt: "2026-08-09T10:00:00.000Z",
        deployed: true,
        paused: false,
      }).status,
    ).toBe("fresh");
    expect(
      evaluateFreshness({
        registration,
        now,
        acceptedAt: "2026-08-09T09:59:59.000Z",
        lastActionTakenAt: "2026-08-09T10:00:00.000Z",
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
        lastActionTakenAt: "2026-08-10T09:00:00.000Z",
        deployed: true,
        paused: false,
      }).status,
    ).toBe("missing");
    expect(
      evaluateFreshness({
        registration,
        now,
        acceptedAt: undefined,
        lastActionTakenAt: undefined,
        deployed: false,
        paused: false,
      }).status,
    ).toBe("schedule-missing");
    expect(
      evaluateFreshness({
        registration,
        now,
        acceptedAt: undefined,
        lastActionTakenAt: undefined,
        deployed: true,
        paused: true,
      }).status,
    ).toBe("schedule-paused");
  });

  test("keeps receipt enforcement pending until a post-activation run exhausts grace", () => {
    const activationRegistration = {
      ...registration,
      receiptRequiredAfter: "2026-08-11T23:52:18.000Z",
    };
    expect(
      evaluateFreshness({
        registration: activationRegistration,
        now: new Date("2026-08-12T03:00:00.000Z"),
        acceptedAt: undefined,
        lastActionTakenAt: undefined,
        deployed: true,
        paused: false,
      }).status,
    ).toBe("pending");
    expect(
      evaluateFreshness({
        registration: activationRegistration,
        now: new Date("2026-08-12T03:00:00.000Z"),
        acceptedAt: undefined,
        lastActionTakenAt: "2026-08-12T02:00:00.000Z",
        deployed: true,
        paused: false,
      }).status,
    ).toBe("pending");
    expect(
      evaluateFreshness({
        registration: activationRegistration,
        now: new Date("2026-08-12T05:00:01.000Z"),
        acceptedAt: undefined,
        lastActionTakenAt: "2026-08-12T02:00:00.000Z",
        deployed: true,
        paused: false,
      }).status,
    ).toBe("missing");
  });
});

describe("publishReportFreshnessMetrics", () => {
  test("publishes pending schedules outside the alerting range", async () => {
    publishReportFreshnessMetrics([
      {
        scheduleId: "daily-report",
        status: "pending",
        acceptedAt: undefined,
        ageHours: undefined,
        maximumAgeHours: 26,
      },
    ]);

    const metric = await reportFreshnessState.get();
    expect(metric.values[0]?.value).toBe(2);
  });

  test("removes labels for schedules absent from the latest scan", async () => {
    reportFreshnessState.set({ schedule_id: "deleted-dynamic-task" }, -1);

    publishReportFreshnessMetrics([
      {
        scheduleId: "daily-report",
        status: "fresh",
        acceptedAt: "2026-08-10T12:00:00.000Z",
        ageHours: 0,
        maximumAgeHours: 26,
      },
    ]);

    const metric = await reportFreshnessState.get();
    const values = metric.values;
    expect(
      values.map((value) => ({
        scheduleId: value.labels.schedule_id,
        value: value.value,
      })),
    ).toEqual([{ scheduleId: "daily-report", value: 1 }]);
  });
});

describe("freshnessDeploymentState", () => {
  test("recognizes legacy prefix-only dynamic agent schedules", () => {
    expect(
      freshnessDeploymentState({
        scheduleId: "agent-task-legacy-check-abc123",
        paused: false,
        memo: undefined,
      }),
    ).toEqual({
      paused: false,
      dynamic: true,
      lastActionTakenAt: undefined,
    });
  });

  test("recognizes custom dynamic IDs through the memo marker", () => {
    expect(
      freshnessDeploymentState({
        scheduleId: "custom-agent-check",
        paused: true,
        memo: { dynamicAgentTask: true },
        recentActions: [{ takenAt: new Date("2026-08-11T23:52:18.000Z") }],
      }),
    ).toEqual({
      paused: true,
      dynamic: true,
      lastActionTakenAt: "2026-08-11T23:52:18.000Z",
    });
  });
});
