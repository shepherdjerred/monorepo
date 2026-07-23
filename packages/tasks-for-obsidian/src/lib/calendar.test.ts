import { describe, expect, test } from "bun:test";

import {
  addMonths,
  currentMonth,
  monthGrid,
  monthOf,
  monthTitle,
} from "./calendar";

function ymds(weeks: ReturnType<typeof monthGrid>): (string | null)[][] {
  return weeks.map((week) => week.map((cell) => cell.ymd));
}

describe("monthGrid", () => {
  test("July 2026 starts on Wednesday and spans 5 whole weeks", () => {
    const weeks = monthGrid({ year: 2026, month: 6 });
    expect(weeks).toHaveLength(5);
    for (const week of weeks) expect(week).toHaveLength(7);
    // 2026-07-01 is a Wednesday → 3 leading padding cells
    expect(ymds(weeks)[0]).toEqual([
      null,
      null,
      null,
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
    ]);
    // Last day lands on Friday → 1 trailing padding cell
    expect(weeks[4]?.at(-2)?.ymd).toBe("2026-07-31");
    expect(weeks[4]?.at(-1)?.ymd).toBeNull();
  });

  test("February in a leap year has 29 days", () => {
    const days = monthGrid({ year: 2028, month: 1 })
      .flat()
      .filter((cell) => cell.ymd !== null);
    expect(days).toHaveLength(29);
    expect(days.at(-1)?.ymd).toBe("2028-02-29");
  });

  test("a month starting on Sunday has no leading padding", () => {
    // 2026-02-01 is a Sunday
    const weeks = monthGrid({ year: 2026, month: 1 });
    expect(weeks[0]?.[0]?.ymd).toBe("2026-02-01");
  });

  test("cell keys are unique within a month", () => {
    const keys = monthGrid({ year: 2026, month: 6 })
      .flat()
      .map((cell) => cell.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("month navigation", () => {
  test("addMonths wraps across year boundaries both ways", () => {
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({
      year: 2027,
      month: 0,
    });
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({
      year: 2025,
      month: 11,
    });
  });

  test("monthOf and currentMonth agree on shapes", () => {
    expect(monthOf("2026-07-22")).toEqual({ year: 2026, month: 6 });
    expect(currentMonth(new Date(2026, 6, 22))).toEqual({
      year: 2026,
      month: 6,
    });
  });

  test("monthTitle renders a human month", () => {
    expect(monthTitle({ year: 2026, month: 6 })).toBe("July 2026");
  });
});
