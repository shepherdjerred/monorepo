import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { isCompletedOn, nextOccurrenceAfter, occursOn } from "./recurrence";
import type { Task } from "./types";
import { taskId } from "./types";

/**
 * Timezone regression guard for the recurrence boundary.
 *
 * `@tasknotes/model` resolves recurrence in UTC and reads results back with
 * `getUTC*`. `recurrence.ts` used to hand it LOCAL midnight, which in a
 * UTC-POSITIVE zone is the previous UTC day — so every recurring task, and its
 * completion checkbox, was a day late east of Greenwich. Nothing caught it
 * because the maintainer is in US Pacific and CI runs UTC, where local midnight
 * still lands on the same UTC calendar day.
 *
 * So this suite sets `Bun.env.TZ` itself rather than documenting a `TZ=`
 * invocation someone has to remember: the guard has to hold under the CI
 * environment that missed the bug. Each zone block additionally asserts the
 * offset it actually got, so the suite fails loudly if a runtime ever stops
 * honouring a mid-process `TZ` change and quietly reduces to "UTC four times".
 */

const MONDAY = "2026-01-05";
const TUESDAY = "2026-01-06";
const NEXT_MONDAY = "2026-01-12";

function makeTask(overrides: Partial<Task> = {}): Task {
  const base: Task = {
    id: taskId("task-1"),
    path: "tasks/task-1.md",
    title: "Test task",
    status: "open",
    priority: "normal",
    contexts: [],
    projects: [],
    tags: [],
    completeInstances: [],
    skippedInstances: [],
    timeEntries: [],
    blockedBy: [],
    reminders: [],
    archived: false,
    totalTrackedTime: 0,
    isBlocked: false,
    isBlocking: false,
    extraFields: {},
  };
  return { ...base, ...overrides };
}

/**
 * `offsetMinutes` is `Date.prototype.getTimezoneOffset()`'s sign convention:
 * MINUTES BEHIND UTC, so a zone east of Greenwich is negative. Kiritimati
 * (UTC+14) is the worst case in either direction.
 */
const ZONES: readonly { name: string; offsetMinutes: number }[] = [
  { name: "UTC", offsetMinutes: 0 },
  { name: "America/Los_Angeles", offsetMinutes: 480 },
  { name: "Asia/Tokyo", offsetMinutes: -540 },
  { name: "Pacific/Kiritimati", offsetMinutes: -840 },
];

/**
 * The zone this file must leave the process in, resolved BEFORE anything here
 * touches `TZ` — an unset `TZ` means "whatever the host is", which is a real
 * zone name `Intl` can name but the environment cannot hold.
 *
 * Restoring by ASSIGNMENT is load-bearing: Bun re-reads the timezone when
 * `Bun.env.TZ` is assigned, but deleting the key leaves the cached
 * zone in place AND stops later assignments from taking effect, which would
 * silently pin every block after the first to one zone.
 */
const HOST_TIMEZONE =
  Bun.env["TZ"] ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;

for (const zone of ZONES) {
  describe(`recurrence in ${zone.name}`, () => {
    beforeAll(() => {
      Bun.env["TZ"] = zone.name;
    });

    afterAll(() => {
      Bun.env["TZ"] = HOST_TIMEZONE;
    });

    test("the process really is in this zone", () => {
      // Structural, not decorative: without this the three non-UTC blocks
      // could silently run as UTC and assert nothing.
      expect(new Date(`${MONDAY}T12:00:00Z`).getTimezoneOffset()).toBe(
        zone.offsetMinutes,
      );
    });

    test("a weekly rule fires on its own DTSTART weekday", () => {
      const weekly = makeTask({
        recurrence: "FREQ=WEEKLY;BYDAY=MO",
        scheduled: MONDAY,
      });
      expect(occursOn(weekly, MONDAY)).toBe(true);
      expect(occursOn(weekly, TUESDAY)).toBe(false);
      expect(occursOn(weekly, NEXT_MONDAY)).toBe(true);
    });

    test("the completion checkbox reads the day it was recorded on", () => {
      const weekly = makeTask({
        recurrence: "FREQ=WEEKLY;BYDAY=MO",
        scheduled: MONDAY,
        completeInstances: [MONDAY],
      });
      expect(isCompletedOn(weekly, MONDAY)).toBe(true);
      expect(isCompletedOn(weekly, NEXT_MONDAY)).toBe(false);
    });

    test("the next occurrence lands a whole week out", () => {
      const weekly = makeTask({
        recurrence: "FREQ=WEEKLY;BYDAY=MO",
        scheduled: MONDAY,
      });
      expect(nextOccurrenceAfter(weekly, MONDAY)).toBe(NEXT_MONDAY);
    });

    test("a monthly rule fires on the 1st, whatever the device clock says", () => {
      const monthly = makeTask({
        recurrence: "DTSTART:20260301;FREQ=MONTHLY;BYMONTHDAY=1",
        scheduled: "2026-08-01",
      });
      expect(occursOn(monthly, "2026-08-01")).toBe(true);
      expect(occursOn(monthly, "2026-07-31")).toBe(false);
      expect(nextOccurrenceAfter(monthly, "2026-08-01")).toBe("2026-09-01");
    });

    test("a DST boundary does not shift the occurrence", () => {
      // 2026-03-08 (US) and 2026-03-29 (EU) are spring-forward Sundays; a
      // local-arithmetic day walk can land on 23:00 the previous day.
      const daily = makeTask({
        recurrence: "FREQ=DAILY",
        scheduled: "2026-03-07",
      });
      expect(nextOccurrenceAfter(daily, "2026-03-07")).toBe("2026-03-08");
      expect(nextOccurrenceAfter(daily, "2026-03-28")).toBe("2026-03-29");
      expect(occursOn(daily, "2026-03-08")).toBe(true);
      expect(occursOn(daily, "2026-03-29")).toBe(true);
    });
  });
}
