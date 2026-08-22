import { describe, expect, test } from "vitest";
import {
  canEnableRecap,
  computeNextRecapAt,
  isValidCron,
} from "./recap-schedule.ts";

describe("computeNextRecapAt", () => {
  test("advances to the next matching time in UTC", () => {
    // Default schedule: Fridays at 17:00 UTC. 2026-08-08 is a Saturday, so the
    // next fire is the following Friday.
    expect(
      computeNextRecapAt(
        "0 17 * * 5",
        new Date("2026-08-08T12:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-08-14T17:00:00.000Z");
  });

  test("never returns a time in the past", () => {
    // The dispatcher advances from `now` even when a fire was missed, which is
    // what keeps a chronically failing channel from being retried every minute.
    const now = new Date("2026-08-08T12:00:00.000Z");
    expect(computeNextRecapAt("0 17 * * 5", now).getTime()).toBeGreaterThan(
      now.getTime(),
    );
  });

  test("rejects an invalid expression rather than never firing", () => {
    expect(() =>
      computeNextRecapAt("not a cron", new Date("2026-08-08T12:00:00.000Z")),
    ).toThrow();
  });
});

describe("isValidCron", () => {
  test.each(["0 17 * * 5", "0 0 * * *", "*/15 * * * *"])(
    "accepts %s",
    (cron) => {
      expect(isValidCron(cron)).toBe(true);
    },
  );

  test.each(["", "not a cron", "99 99 * * *"])("rejects %p", (cron) => {
    expect(isValidCron(cron)).toBe(false);
  });
});

describe("canEnableRecap", () => {
  test("rejects enabling without a configured channel", () => {
    expect(canEnableRecap(true, null)).toBe(false);
  });

  test("accepts enabling with a configured channel", () => {
    expect(canEnableRecap(true, "channel")).toBe(true);
  });

  test("accepts disabling without a configured channel", () => {
    expect(canEnableRecap(false, null)).toBe(true);
  });
});
