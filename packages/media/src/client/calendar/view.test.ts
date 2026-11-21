import { expect, test } from "vitest";
import { CalendarQuerySchema } from "#shared/household/calendar.ts";
import { monthWeeks } from "./dates.ts";
import {
  anchoredDay,
  calendarReadPath,
  calendarSearch,
  dayAnchor,
  isFiltered,
  readCalendarView,
  visibleRange,
  type CalendarView,
} from "./view.ts";

const TODAY = "2026-11-21";

function read(search: string): CalendarView {
  return readCalendarView(new URLSearchParams(search), TODAY);
}

test("an address with nothing in it is this month, unfiltered, laid out by the screen", () => {
  expect(read("")).toEqual({
    month: "2026-11",
    kind: "all",
    status: "all",
    layout: null,
  });
  expect(calendarSearch(read(""), TODAY)).toBe("");
  expect(isFiltered(read(""))).toBe(false);
});

test("the month, both filters and the layout round-trip through the address", () => {
  const search = "?month=2027-02&kind=episode&status=missing&view=agenda";
  const view = read(search);
  expect(view).toEqual({
    month: "2027-02",
    kind: "episode",
    status: "missing",
    layout: "agenda",
  });
  expect(calendarSearch(view, TODAY)).toBe(search);
  expect(isFiltered(view)).toBe(true);
  // The month the viewer is in is left out, so the link means "this month".
  expect(calendarSearch({ ...view, month: "2026-11" }, TODAY)).toBe(
    "?kind=episode&status=missing&view=agenda",
  );
});

test("a value the page does not know reads as that setting's default", () => {
  expect(read("?month=2026-13&kind=vhs&status=maybe&view=week")).toEqual(
    read(""),
  );
  expect(read("?month=tomorrow").month).toBe("2026-11");
});

test("a fragment names a day only when it is a real date", () => {
  expect(dayAnchor("2026-11-20")).toBe("day-2026-11-20");
  expect(anchoredDay("#day-2026-11-20")).toBe("2026-11-20");
  expect(anchoredDay("#day-2026-11-31")).toBeNull();
  expect(anchoredDay("#verify=token")).toBeNull();
  expect(anchoredDay("")).toBeNull();
});

test("the agenda asks for the month itself and the grid for its whole weeks", () => {
  expect(visibleRange("2026-11", "agenda")).toEqual({
    from: "2026-11-01",
    to: "2026-11-30",
  });
  expect(visibleRange("2026-11", "month")).toEqual({
    from: "2026-11-01",
    to: "2026-12-05",
  });
  expect(visibleRange("2026-08", "month")).toEqual({
    from: "2026-07-26",
    to: "2026-09-05",
  });
  expect(visibleRange("2028-02", "agenda").to).toBe("2028-02-29");
});

test("every range the page can show is one the API accepts", () => {
  // Twenty years of months, in both layouts.
  for (let index = 0; index < 240; index += 1) {
    const month = `${String(2020 + Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`;
    expect(monthWeeks(month).length).toBeLessThanOrEqual(6);
    for (const layout of ["agenda", "month"] as const) {
      const path = calendarReadPath(
        { kind: "all", status: "all" },
        visibleRange(month, layout),
        null,
      );
      const query = new URLSearchParams(path.slice(path.indexOf("?")));
      expect(
        CalendarQuerySchema.safeParse(Object.fromEntries(query)).success,
        path,
      ).toBe(true);
    }
  }
});

test("a read names the range, the filters, and the release to carry on after", () => {
  const range = visibleRange("2026-11", "month");
  expect(
    calendarReadPath({ kind: "digital", status: "available" }, range, null),
  ).toBe(
    "/calendar?from=2026-11-01&to=2026-12-05&kind=digital&status=available&limit=100",
  );
  const cursor = JSON.stringify({ date: "2026-11-20", id: "release-1" });
  const path = calendarReadPath({ kind: "all", status: "all" }, range, cursor);
  expect(new URLSearchParams(path.slice(path.indexOf("?"))).get("cursor")).toBe(
    cursor,
  );
});
