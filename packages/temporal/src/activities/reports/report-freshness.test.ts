import { afterEach, describe, expect, test } from "vitest";
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

  test("stops pending from masking a schedule that never runs after activation", () => {
    const activationRegistration = {
      ...registration,
      receiptRequiredAfter: "2026-08-11T23:52:18.000Z",
    };
    expect(
      evaluateFreshness({
        registration: activationRegistration,
        now: new Date("2026-08-13T01:52:18.000Z"),
        acceptedAt: undefined,
        lastActionTakenAt: undefined,
        deployed: true,
        paused: false,
      }).status,
    ).toBe("pending");
    expect(
      evaluateFreshness({
        registration: activationRegistration,
        now: new Date("2026-08-13T01:52:19.000Z"),
        acceptedAt: undefined,
        lastActionTakenAt: undefined,
        deployed: true,
        paused: false,
      }).status,
    ).toBe("missing");
    expect(
      evaluateFreshness({
        registration: activationRegistration,
        now: new Date("2026-08-20T00:00:00.000Z"),
        acceptedAt: "2026-07-01T00:00:00.000Z",
        lastActionTakenAt: "2026-08-11T00:00:00.000Z",
        deployed: true,
        paused: false,
      }).status,
    ).toBe("missing");
  });

  test("rejects an unparseable receipt activation timestamp", () => {
    expect(() =>
      evaluateFreshness({
        registration: { ...registration, receiptRequiredAfter: "not-a-date" },
        now: new Date("2026-08-10T12:00:00.000Z"),
        acceptedAt: undefined,
        lastActionTakenAt: undefined,
        deployed: true,
        paused: false,
      }),
    ).toThrow("unparseable receiptRequiredAfter");
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

describe("newly rolled-out schedule activation", () => {
  // A brand-new weekly schedule has no receipt and no prior action on its
  // first deployment. `evaluateFreshness` then bounds the pending window at
  // receiptRequiredAfter + cadence + grace, so an activation inherited from an
  // older worker is already expired and the 15-minute monitor reports
  // `missing` — paging TemporalReportHeartbeatStale for a full cadence before
  // the schedule has had any chance to run.
  const scannerRegistration = {
    scheduleId: "main-vuln-scan-weekly",
    reportType: "main-vuln-scan",
    cadenceHours: 168,
    graceHours: 6,
    receiptRequiredAfter: "2026-09-01T00:00:00.000Z",
  };

  function statusAtRollout(receiptRequiredAfter: string, now: string) {
    return evaluateFreshness({
      registration: { ...scannerRegistration, receiptRequiredAfter },
      now: new Date(now),
      acceptedAt: undefined,
      lastActionTakenAt: undefined,
      deployed: true,
      paused: false,
    }).status;
  }

  test("stays pending from rollout until the first run can deliver", () => {
    // Rollout day, and the first Sunday 05:00 PT run (2026-09-06T12:00Z).
    expect(
      statusAtRollout("2026-09-01T00:00:00.000Z", "2026-09-01T00:05:00.000Z"),
    ).toBe("pending");
    expect(
      statusAtRollout("2026-09-01T00:00:00.000Z", "2026-09-06T12:00:00.000Z"),
    ).toBe("pending");
  });

  test("reports missing only after a full cadence plus grace elapsed", () => {
    // 168h + 6h after activation = 2026-09-08T06:00Z.
    expect(
      statusAtRollout("2026-09-01T00:00:00.000Z", "2026-09-08T05:59:00.000Z"),
    ).toBe("pending");
    expect(
      statusAtRollout("2026-09-01T00:00:00.000Z", "2026-09-08T06:01:00.000Z"),
    ).toBe("missing");
  });

  test("an inherited stale activation would page before the first run", () => {
    // The defect this guards: the original worker activation makes the very
    // first freshness evaluation report `missing` on rollout day.
    expect(
      statusAtRollout("2026-08-11T23:52:18.000Z", "2026-09-01T00:05:00.000Z"),
    ).toBe("missing");
  });
});
