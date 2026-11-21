import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  dayLabel,
  dayOfMonth,
  firstDay,
  lastDay,
  localToday,
  monthDays,
  monthLabel,
  monthOf,
  monthWeeks,
  parseDate,
  parseMonth,
  shiftDays,
  shiftMonth,
  shiftMonthOfDate,
  weekdayNames,
  weekdayShort,
  weekEnds,
} from "./dates.ts";
import { keyDestination } from "./grid-keys.ts";

/*
 * Every zone here would move a date if a civil date were ever read as a
 * moment: west of UTC a naive `new Date("2026-11-01")` is October 31, and
 * each of these but UTC changes its clocks, by an hour or by half of one.
 */
const ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/St_Johns",
  "Europe/London",
  "Australia/Lord_Howe",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
] as const;

const startingZone = Bun.env.TZ;

afterAll(() => {
  if (startingZone === undefined) delete Bun.env.TZ;
  else Bun.env.TZ = startingZone;
});

describe.each(ZONES)("with the viewer's clock in %s", (zone) => {
  beforeAll(() => {
    Bun.env.TZ = zone;
    // The suite proves nothing unless the zone really changed.
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
  });

  test("a year of days is walked one date at a time, with none repeated or skipped", () => {
    for (const year of [2026, 2028]) {
      const days: string[] = [];
      for (
        let day = `${String(year)}-01-01`;
        monthOf(day) < `${String(year + 1)}-01`;
        day = shiftDays(day, 1)
      ) {
        days.push(day);
      }
      expect(days).toHaveLength(year === 2028 ? 366 : 365);
      expect(new Set(days).size).toBe(days.length);
      expect(days.at(-1)).toBe(`${String(year)}-12-31`);
      // And back again.
      expect(shiftDays(`${String(year)}-12-31`, 1 - days.length)).toBe(
        `${String(year)}-01-01`,
      );
    }
  });

  test("the days a clock change falls on are ordinary days", () => {
    // United States, 2026: forward on March 8, back on November 1.
    expect(shiftDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(shiftDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(shiftDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(shiftDays("2026-11-02", -1)).toBe("2026-11-01");
    // Europe, 2026: forward on March 29, back on October 25.
    expect(shiftDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(shiftDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(shiftDays("2026-10-25", 7)).toBe("2026-11-01");
    // Lord Howe Island, 2026: back on April 5, forward on October 4.
    expect(shiftDays("2026-04-05", 1)).toBe("2026-04-06");
    expect(shiftDays("2026-10-04", -1)).toBe("2026-10-03");
  });

  test("month ends, leap days and year ends hold", () => {
    expect(lastDay("2026-02")).toBe("2026-02-28");
    expect(lastDay("2028-02")).toBe("2028-02-29");
    expect(lastDay("2026-12")).toBe("2026-12-31");
    expect(shiftDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 14)).toBe("2028-01");
    expect(shiftMonth("2026-11", -11)).toBe("2025-12");
    // A month on from the 31st is the end of a shorter month, not the next.
    expect(shiftMonthOfDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftMonthOfDate("2028-01-31", 1)).toBe("2028-02-29");
    expect(shiftMonthOfDate("2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftMonthOfDate("2026-11-14", 1)).toBe("2026-12-14");
    expect(shiftMonthOfDate("2026-12-14", 1)).toBe("2027-01-14");
  });

  test("a month lists exactly its own days", () => {
    for (const [month, count] of [
      ["2026-02", 28],
      ["2028-02", 29],
      ["2026-03", 31],
      ["2026-11", 30],
    ] as const) {
      const days = monthDays(month);
      expect(days).toHaveLength(count);
      expect(days[0]).toBe(firstDay(month));
      expect(days.at(-1)).toBe(lastDay(month));
      expect(days.every((day) => monthOf(day) === month)).toBe(true);
    }
  });

  test("a month grid is whole Sunday-to-Saturday weeks around the month", () => {
    // November 2026 starts on a Sunday and ends on a Monday.
    const november = monthWeeks("2026-11");
    expect(november).toHaveLength(5);
    expect(november[0]?.[0]).toBe("2026-11-01");
    expect(november.at(-1)).toEqual([
      "2026-11-29",
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
      "2026-12-05",
    ]);
    // March 2026 holds the clock change and starts on a Sunday.
    expect(monthWeeks("2026-03")[1]).toEqual([
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
    ]);
    // February 2026 is exactly four weeks; August 2026 needs six.
    expect(monthWeeks("2026-02")).toHaveLength(4);
    const august = monthWeeks("2026-08");
    expect(august).toHaveLength(6);
    expect(august[0]?.[0]).toBe("2026-07-26");
    expect(august.at(-1)?.[6]).toBe("2026-09-05");
    for (const week of [...november, ...august]) {
      expect(week).toHaveLength(7);
      expect(weekdayShort(week[0] ?? "", "en-US")).toBe("Sun");
    }
    expect(weekEnds("2026-11-04")).toEqual({
      start: "2026-11-01",
      end: "2026-11-07",
    });
  });

  test("a date is named as itself, never as the day before or after", () => {
    expect(dayLabel("2026-11-01", "en-US")).toBe("Sunday, November 1");
    expect(dayLabel("2026-03-08", "en-US")).toBe("Sunday, March 8");
    expect(dayLabel("2026-12-31", "en-US")).toBe("Thursday, December 31");
    expect(dayLabel("2028-02-29", "en-US")).toBe("Tuesday, February 29");
    expect(monthLabel("2026-11", "en-US")).toBe("November 2026");
    expect(monthLabel("2027-01", "en-US")).toBe("January 2027");
    expect(dayOfMonth("2026-11-01")).toBe(1);
    expect(weekdayNames("en-US").map((name) => name.short)).toEqual([
      "Sun",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
    ]);
    expect(weekdayNames("en-US")[0]?.long).toBe("Sunday");
  });

  test("the grid's keys move by date arithmetic, across months and years", () => {
    expect(keyDestination("ArrowRight", "2026-10-31")).toBe("2026-11-01");
    expect(keyDestination("ArrowLeft", "2026-11-01")).toBe("2026-10-31");
    expect(keyDestination("ArrowDown", "2026-10-25")).toBe("2026-11-01");
    expect(keyDestination("ArrowUp", "2026-03-08")).toBe("2026-03-01");
    expect(keyDestination("ArrowDown", "2026-12-28")).toBe("2027-01-04");
    expect(keyDestination("Home", "2026-11-04")).toBe("2026-11-01");
    expect(keyDestination("End", "2026-11-04")).toBe("2026-11-07");
    expect(keyDestination("PageDown", "2026-01-31")).toBe("2026-02-28");
    expect(keyDestination("PageUp", "2027-01-15")).toBe("2026-12-15");
    expect(keyDestination("Enter", "2026-11-04")).toBeNull();
    expect(keyDestination("a", "2026-11-04")).toBeNull();
  });
});

test("today is the viewer's own date, which does depend on where they are", () => {
  const moment = new Date("2026-11-01T06:30:00.000Z");
  Bun.env.TZ = "America/Los_Angeles";
  expect(localToday(moment)).toBe("2026-10-31");
  Bun.env.TZ = "Pacific/Kiritimati";
  expect(localToday(moment)).toBe("2026-11-01");
  Bun.env.TZ = "UTC";
  expect(localToday(moment)).toBe("2026-11-01");
  expect(localToday(new Date("2026-03-08T23:59:59.000Z"))).toBe("2026-03-08");
});

test("an address or a date field names a month or a day only when it is a real one", () => {
  expect(parseMonth("2026-11")).toBe("2026-11");
  expect(parseMonth("2026-13")).toBeNull();
  expect(parseMonth("2026-1")).toBeNull();
  expect(parseMonth("november")).toBeNull();
  expect(parseMonth(null)).toBeNull();
  expect(parseDate("2028-02-29")).toBe("2028-02-29");
  expect(parseDate("2026-02-29")).toBeNull();
  expect(parseDate("2026-11-31")).toBeNull();
  expect(parseDate("")).toBeNull();
  expect(parseDate(null)).toBeNull();
});
