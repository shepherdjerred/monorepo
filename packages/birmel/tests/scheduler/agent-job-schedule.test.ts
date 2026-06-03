import { describe, expect, test } from "bun:test";
import {
  getNextAgentJobRun,
  resolveAgentJobSchedule,
} from "@shepherdjerred/birmel/scheduler/agent-job-schedule.ts";

describe("agent job schedules", () => {
  test("resolves every schedules", () => {
    const from = new Date("2026-06-03T12:00:00.000Z");
    const schedule = resolveAgentJobSchedule({
      scheduleKind: "every",
      scheduleValue: "15m",
      from,
    });
    expect(schedule.nextRunAt.toISOString()).toBe(
      "2026-06-03T12:15:00.000Z",
    );
  });

  test("resolves one-shot at schedules", () => {
    const schedule = resolveAgentJobSchedule({
      scheduleKind: "at",
      scheduleValue: "2026-06-03T13:00:00.000Z",
      from: new Date("2026-06-03T12:00:00.000Z"),
    });
    expect(schedule.nextRunAt.toISOString()).toBe(
      "2026-06-03T13:00:00.000Z",
    );
    expect(
      getNextAgentJobRun({
        scheduleKind: "at",
        scheduleValue: schedule.scheduleValue,
        timezone: schedule.timezone,
      }),
    ).toBeNull();
  });

  test("resolves cron schedules with timezone", () => {
    const schedule = resolveAgentJobSchedule({
      scheduleKind: "cron",
      scheduleValue: "0 9 * * *",
      timezone: "America/Los_Angeles",
      from: new Date("2026-06-03T12:00:00.000Z"),
    });
    expect(schedule.nextRunAt.toISOString()).toBe(
      "2026-06-03T16:00:00.000Z",
    );
  });
});
