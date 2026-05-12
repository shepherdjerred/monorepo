import { describe, expect, test } from "bun:test";
import {
  CompetitionCronSchema,
  computeNextScheduledUpdateAt,
  DEFAULT_COMPETITION_CRON,
} from "#src/model/competition-cron.ts";

describe("CompetitionCronSchema", () => {
  test.each([
    ["0 0 * * *", "daily midnight UTC"],
    ["0 9 * * *", "daily 9am UTC"],
    ["0 14 * * *", "daily 2pm UTC"],
    ["0 0 * * 0", "weekly Sunday"],
    ["0 0 * * 1", "weekly Monday"],
    ["0 0 1 * *", "monthly first"],
    ["0 0 1 1 *", "yearly"],
  ])("accepts %s (%s)", (value) => {
    const result = CompetitionCronSchema.safeParse(value);
    expect(result.success).toBe(true);
  });

  test.each([
    ["0 0,12 * * *", "twice daily"],
    ["*/30 * * * *", "every 30 minutes"],
    ["0 * * * *", "hourly"],
    ["* * * * *", "every minute"],
    ["0 0,1 * * *", "midnight + 1am"],
  ])("rejects %s (%s) as below 1-day minimum", (value) => {
    const result = CompetitionCronSchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("once per day");
    }
  });

  test.each([
    ["not a cron", "garbage"],
    ["", "empty"],
    ["0 0", "incomplete"],
    ["99 99 99 99 99", "out-of-range fields"],
  ])("rejects invalid expression %s (%s)", (value) => {
    const result = CompetitionCronSchema.safeParse(value);
    expect(result.success).toBe(false);
  });

  test("trims surrounding whitespace before validation", () => {
    const result = CompetitionCronSchema.safeParse("  0 0 * * *  ");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("0 0 * * *");
    }
  });
});

describe("computeNextScheduledUpdateAt", () => {
  test("returns the next UTC midnight for daily-midnight cron", () => {
    const reference = new Date(Date.UTC(2026, 0, 1, 9, 0, 0));
    const next = computeNextScheduledUpdateAt(
      DEFAULT_COMPETITION_CRON,
      reference,
    );
    expect(next.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  test("returns the upcoming Sunday for a Sunday-midnight cron", () => {
    // 2026-01-01 is a Thursday in UTC.
    const reference = new Date(Date.UTC(2026, 0, 1, 9, 0, 0));
    const next = computeNextScheduledUpdateAt("0 0 * * 0", reference);
    expect(next.toISOString()).toBe("2026-01-04T00:00:00.000Z");
  });

  test("skips past the current minute when current time matches the cron", () => {
    const reference = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const next = computeNextScheduledUpdateAt(
      DEFAULT_COMPETITION_CRON,
      reference,
    );
    expect(next.getTime()).toBeGreaterThan(reference.getTime());
  });
});
