import { describe, expect, test } from "bun:test";

import {
  formatDate,
  formatRelativeDate,
  getDateGroup,
  isOverdue,
  isToday,
  isUpcoming,
  parseLocalDate,
} from "./dates";

// Helper: format a Date as YYYY-MM-DD
function toISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysFromNow(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toISO(d);
}

describe("isToday", () => {
  test("returns true for today's date", () => {
    expect(isToday(toISO(new Date()))).toBe(true);
  });

  test("returns false for yesterday", () => {
    expect(isToday(daysFromNow(-1))).toBe(false);
  });

  test("returns false for tomorrow", () => {
    expect(isToday(daysFromNow(1))).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isToday()).toBe(false);
  });

  test("returns false for empty string", () => {
    // empty string creates an Invalid Date, which won't equal today
    expect(isToday("")).toBe(false);
  });
});

describe("isOverdue", () => {
  test("returns true for yesterday", () => {
    expect(isOverdue(daysFromNow(-1))).toBe(true);
  });

  test("returns true for a date far in the past", () => {
    expect(isOverdue("2020-01-01")).toBe(true);
  });

  test("returns false for today", () => {
    expect(isOverdue(toISO(new Date()))).toBe(false);
  });

  test("returns false for tomorrow", () => {
    expect(isOverdue(daysFromNow(1))).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isOverdue()).toBe(false);
  });
});

describe("isUpcoming", () => {
  test("returns true for a date within the next 7 days", () => {
    expect(isUpcoming(daysFromNow(3))).toBe(true);
  });

  test("returns true for exactly 7 days from now (default)", () => {
    expect(isUpcoming(daysFromNow(7))).toBe(true);
  });

  test("returns false for today", () => {
    expect(isUpcoming(toISO(new Date()))).toBe(false);
  });

  test("returns false for yesterday", () => {
    expect(isUpcoming(daysFromNow(-1))).toBe(false);
  });

  test("returns false for 8 days from now (default window)", () => {
    expect(isUpcoming(daysFromNow(8))).toBe(false);
  });

  test("respects custom day window", () => {
    expect(isUpcoming(daysFromNow(3), 2)).toBe(false);
    expect(isUpcoming(daysFromNow(3), 5)).toBe(true);
  });

  test("returns false for undefined", () => {
    expect(isUpcoming()).toBe(false);
  });
});

describe("formatDate", () => {
  test("formats a date string to 'Mon D' format", () => {
    const result = formatDate("2026-01-15");
    expect(result).toBe("Jan 15");
  });

  test("formats various months correctly", () => {
    expect(formatDate("2026-03-01")).toBe("Mar 1");
    expect(formatDate("2026-12-25")).toBe("Dec 25");
    expect(formatDate("2026-07-04")).toBe("Jul 4");
  });
});

describe("formatRelativeDate", () => {
  test("returns 'Today' for today's date", () => {
    expect(formatRelativeDate(toISO(new Date()))).toBe("Today");
  });

  test("returns 'Tomorrow' for tomorrow", () => {
    expect(formatRelativeDate(daysFromNow(1))).toBe("Tomorrow");
  });

  test("returns 'Yesterday' for yesterday", () => {
    expect(formatRelativeDate(daysFromNow(-1))).toBe("Yesterday");
  });

  test("returns 'In Nd' for 2-7 days ahead", () => {
    expect(formatRelativeDate(daysFromNow(3))).toBe("In 3d");
    expect(formatRelativeDate(daysFromNow(7))).toBe("In 7d");
  });

  test("returns 'Nd ago' for more than 1 day in the past", () => {
    expect(formatRelativeDate(daysFromNow(-5))).toBe("5d ago");
  });

  test("falls back to formatDate for dates more than 7 days ahead", () => {
    const farFuture = daysFromNow(30);
    const result = formatRelativeDate(farFuture);
    // Should be in "Mon D" format, not relative
    expect(result).not.toContain("In");
    expect(result).toMatch(/^\w{3} \d{1,2}$/);
  });
});

describe("getDateGroup", () => {
  test("returns 'Today' for today's date", () => {
    expect(getDateGroup(toISO(new Date()))).toBe("Today");
  });

  test("returns 'Tomorrow' for tomorrow's date", () => {
    expect(getDateGroup(daysFromNow(1))).toBe("Tomorrow");
  });

  test("returns 'Overdue' for past dates", () => {
    expect(getDateGroup(daysFromNow(-3))).toBe("Overdue");
  });

  test("returns formatted date for far future dates", () => {
    const farFuture = daysFromNow(60);
    const result = getDateGroup(farFuture);
    expect(result).toMatch(/^\w{3} \d{1,2}$/);
  });
});

describe("parseLocalDate — timezone correctness", () => {
  test("parses a date-only string in local time, not UTC", () => {
    // new Date("2026-07-10") is UTC midnight; in a negative-UTC zone reading
    // local components would yield the 9th. parseLocalDate must give the 10th.
    const d = parseLocalDate("2026-07-10");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July (0-indexed)
    expect(d.getDate()).toBe(10);
  });

  test("today's date-only string classifies as Today, not Overdue", () => {
    const d = new Date();
    const todayYmd = `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(isToday(todayYmd)).toBe(true);
    expect(isOverdue(todayYmd)).toBe(false);
  });

  test("full timestamps are parsed as-is", () => {
    const d = parseLocalDate("2026-07-10T15:30:00Z");
    expect(d.getTime()).toBe(new Date("2026-07-10T15:30:00Z").getTime());
  });
});
