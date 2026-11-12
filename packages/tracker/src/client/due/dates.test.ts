import { describe, expect, test } from "vitest";
import {
  addDays,
  addMonths,
  dayNumber,
  displayDate,
  endOfWeek,
  fromDayNumber,
  localToday,
  parseDay,
  quickChoices,
  startOfWeek,
  weekday,
} from "./dates.ts";
import { parseDue } from "./parse-due.ts";
import { dueBucket, dueLabel, dueTone } from "./due-display.ts";
import { dueFilterInput, dueFilterName, isDueFilter } from "./due-filter.ts";
import { calendarKey, monthWeeks } from "./calendar.tsx";

// 2026-11-11 is a Wednesday.
const today = "2026-11-11";

describe("calendar day arithmetic", () => {
  test("day numbers round-trip across centuries, leap days and year ends", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    for (const day of [
      "0001-01-01",
      "1900-02-28",
      "2000-02-29",
      "2024-02-29",
      "2026-12-31",
      "2027-01-01",
      "9999-12-31",
    ]) {
      expect(fromDayNumber(dayNumber(day))).toBe(day);
    }
  });

  test("adding days crosses DST changes, month ends and year ends by whole days", () => {
    // US and EU clocks change on these days; no day is lost or doubled.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  test("months clamp to a shorter month's end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  test("weeks run Monday to Sunday", () => {
    expect(weekday(today)).toBe(3);
    expect(startOfWeek(today)).toBe("2026-11-09");
    expect(endOfWeek(today)).toBe("2026-11-15");
    expect(startOfWeek("2026-11-15")).toBe("2026-11-09");
    expect(endOfWeek("2026-12-30")).toBe("2027-01-03");
  });

  test("only real calendar days parse", () => {
    expect(parseDay("2026-02-29")).toBeUndefined();
    expect(parseDay("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseDay("2026-13-01")).toBeUndefined();
    expect(parseDay("0000-01-01")).toBeUndefined();
  });

  test("today is the local calendar day, whatever the hour", () => {
    expect(localToday(new Date(2026, 2, 8, 0, 30))).toBe("2026-03-08");
    expect(localToday(new Date(2026, 2, 8, 23, 59))).toBe("2026-03-08");
    expect(localToday(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
    // Displaying a day never moves it, even on the night clocks change.
    for (const day of [
      "2026-03-08",
      "2026-03-29",
      "2026-11-01",
      "0099-05-01",
    ]) {
      expect(localToday(displayDate(day))).toBe(day);
    }
  });
});

const choices = (day: string) =>
  Object.fromEntries(
    quickChoices(day).map((choice) => [choice.id, choice.day]),
  );

describe("quick choices", () => {
  test("from a Wednesday", () => {
    expect(choices(today)).toEqual({
      today,
      tomorrow: "2026-11-12",
      friday: "2026-11-13",
      monday: "2026-11-16",
      week: "2026-11-18",
      "two-weeks": "2026-11-25",
    });
  });

  test("this Friday is today on a Friday, next Monday is never today", () => {
    expect(choices("2026-11-13")["friday"]).toBe("2026-11-13");
    expect(choices("2026-11-14")["friday"]).toBe("2026-11-20");
    expect(choices("2026-11-15")["monday"]).toBe("2026-11-16");
    expect(choices("2026-11-16")["monday"]).toBe("2026-11-23");
  });

  test("across a year end", () => {
    expect(choices("2026-12-31")).toMatchObject({
      tomorrow: "2027-01-01",
      friday: "2027-01-01",
      monday: "2027-01-04",
      "two-weeks": "2027-01-14",
    });
  });
});

describe("due dates written in words", () => {
  const cases: [string, string | undefined][] = [
    ["today", today],
    ["Tomorrow", "2026-11-12"],
    ["tmrw", "2026-11-12"],
    ["yesterday", "2026-11-10"],
    ["fri", "2026-11-13"],
    ["Friday", "2026-11-13"],
    ["wed", today],
    ["next fri", "2026-11-20"],
    ["mon", "2026-11-16"],
    ["next week", "2026-11-16"],
    ["next month", "2026-12-11"],
    ["eow", "2026-11-15"],
    ["end of month", "2026-11-30"],
    ["+3d", "2026-11-14"],
    ["3 days", "2026-11-14"],
    ["in 2 weeks", "2026-11-25"],
    ["+1w", "2026-11-18"],
    ["+1m", "2026-12-11"],
    ["jan 15", "2027-01-15"],
    ["15 January", "2027-01-15"],
    ["dec 1", "2026-12-01"],
    ["nov 11", today],
    ["nov 10", "2027-11-10"],
    ["Mar 3, 2030", "2030-03-03"],
    ["feb 29", "2028-02-29"],
    ["2026-12-01", "2026-12-01"],
    ["2026-02-30", undefined],
    ["feb 30", undefined],
    ["soon", undefined],
    ["", undefined],
    ["t", undefined],
  ];
  test.each(cases)("%s", (text, expected) => {
    expect(parseDue(text, today, "en-US")).toBe(expected);
  });

  test("relative words cross month and year ends", () => {
    expect(parseDue("tomorrow", "2026-12-31")).toBe("2027-01-01");
    expect(parseDue("+1m", "2026-01-31")).toBe("2026-02-28");
    expect(parseDue("+1d", "2026-03-07")).toBe("2026-03-08");
  });

  test("month names in the browser's language are understood", () => {
    expect(parseDue("15 janvier", today, "fr-FR")).toBe("2027-01-15");
  });
});

describe("how due dates show", () => {
  test("overdue only for open work; today and tomorrow are due soon", () => {
    expect(dueTone("2026-11-10", today, "started")).toBe("overdue");
    expect(dueTone("2026-11-10", today, "completed")).toBe("later");
    expect(dueTone("2026-11-10", today, "canceled")).toBe("later");
    expect(dueTone("2026-11-10", today, "duplicate")).toBe("later");
    expect(dueTone(today, today, "triage")).toBe("soon");
    expect(dueTone("2026-11-12", today, "backlog")).toBe("soon");
    expect(dueTone("2026-11-13", today, "unstarted")).toBe("later");
  });

  test("labels name nearby days and weekdays, then a short date", () => {
    expect(dueLabel(today, today)).toBe("Today");
    expect(dueLabel("2026-11-12", today)).toBe("Tomorrow");
    expect(dueLabel("2026-11-10", today)).toBe("Yesterday");
    const weekdayName = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
    }).format(displayDate("2026-11-17"));
    expect(dueLabel("2026-11-17", today)).toBe(weekdayName);
    expect(dueLabel("2026-11-18", today)).not.toBe(
      new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(
        displayDate("2026-11-18"),
      ),
    );
    expect(dueLabel("2027-01-15", today)).toContain("2027");
  });

  test("grouping: overdue, today, this week, later, none, and finished past work apart", () => {
    expect(dueBucket(null, today, "started")).toBe("none");
    expect(dueBucket("2026-11-01", today, "started")).toBe("overdue");
    expect(dueBucket("2026-11-01", today, "completed")).toBe("past");
    expect(dueBucket(today, today, "completed")).toBe("today");
    expect(dueBucket("2026-11-15", today, "started")).toBe("week");
    expect(dueBucket("2026-11-16", today, "started")).toBe("later");
  });
});

describe("the due filter", () => {
  test("presets become server filters with the browser's today", () => {
    expect(dueFilterInput("overdue", today, false)).toEqual({
      overdue: true,
      today,
      states: ["triage", "backlog", "unstarted", "started"],
    });
    expect(dueFilterInput("overdue", today, true)).toEqual({
      overdue: true,
      today,
    });
    expect(dueFilterInput("today", today, false)).toEqual({
      dueAfter: today,
      dueBefore: today,
    });
    expect(dueFilterInput("week", today, false)).toEqual({
      dueAfter: today,
      dueBefore: "2026-11-15",
    });
    expect(dueFilterInput("none", today, false)).toEqual({
      hasDueDate: false,
    });
    expect(dueFilterInput("2026-12-01", today, false)).toEqual({
      dueBefore: "2026-12-01",
    });
    expect(dueFilterInput(null, today, false)).toEqual({});
  });

  test("a hand-edited value is not a filter", () => {
    expect(isDueFilter("someday")).toBe(false);
    expect(isDueFilter("2026-02-30")).toBe(false);
    expect(isDueFilter("week")).toBe(true);
    expect(dueFilterName("overdue", today)).toBe("Overdue");
    expect(dueFilterName("2026-11-12", today)).toBe("Due by Tomorrow");
  });
});

describe("the month grid", () => {
  test("six Monday-first weeks around the month", () => {
    const weeks = monthWeeks("2026-11-11");
    expect(weeks).toHaveLength(6);
    expect(weeks[0]?.[0]).toBe("2026-10-26");
    expect(weeks.flat()).toContain("2026-11-30");
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  test("keys move by day, week, month and year", () => {
    expect(calendarKey("ArrowRight", false, "2026-11-30")).toBe("2026-12-01");
    expect(calendarKey("ArrowLeft", false, "2026-03-01")).toBe("2026-02-28");
    expect(calendarKey("ArrowDown", false, today)).toBe("2026-11-18");
    expect(calendarKey("ArrowUp", false, today)).toBe("2026-11-04");
    expect(calendarKey("Home", false, today)).toBe("2026-11-09");
    expect(calendarKey("End", false, today)).toBe("2026-11-15");
    expect(calendarKey("PageDown", false, "2026-01-31")).toBe("2026-02-28");
    expect(calendarKey("PageUp", true, "2028-02-29")).toBe("2027-02-28");
    expect(calendarKey("a", false, today)).toBeUndefined();
  });
});
