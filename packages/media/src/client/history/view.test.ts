import { afterAll, expect, test } from "vitest";
import { PlaybackQuerySchema } from "#shared/household/playback.ts";
import {
  dayStart,
  EVERYTHING,
  filterKey,
  historyReadPath,
  historySearch,
  isFiltered,
  localDay,
  readHistoryView,
  statisticsReadPath,
  type HistoryView,
} from "./view.ts";

const startingZone = Bun.env.TZ;

afterAll(() => {
  if (startingZone === undefined) delete Bun.env.TZ;
  else Bun.env.TZ = startingZone;
});

function read(search: string): HistoryView {
  return readHistoryView(new URLSearchParams(search));
}

function query(path: string) {
  return Object.fromEntries(new URLSearchParams(path.slice(path.indexOf("?"))));
}

test("an address with nothing in it narrows nothing", () => {
  expect(read("")).toEqual(EVERYTHING);
  expect(historySearch(EVERYTHING)).toBe("");
  expect(filterKey(EVERYTHING)).toBe("");
  expect(isFiltered(EVERYTHING)).toBe(false);
  expect(statisticsReadPath(EVERYTHING)).toBe("/playback/statistics");
  expect(historyReadPath(EVERYTHING, null)).toBe("/playback/history?limit=25");
});

test("the search, the person and the days round-trip through the address", () => {
  const search =
    "?search=the+bear&userId=person-1&from=2026-11-01T07%3A00%3A00.000Z&to=2026-11-15T08%3A00%3A00.000Z";
  const view = read(search);
  expect(view).toEqual({
    search: "the bear",
    person: "person-1",
    from: "2026-11-01T07:00:00.000Z",
    to: "2026-11-15T08:00:00.000Z",
  });
  expect(historySearch(view)).toBe(search);
  expect(isFiltered(view)).toBe(true);
});

test("what the page cannot read is left out, not sent to the API", () => {
  expect(read("?from=yesterday&to=2026-11-15&userId=&cursor=abc")).toEqual(
    EVERYTHING,
  );
  expect(read(`?search=${"a".repeat(250)}`).search).toHaveLength(200);
  // A search of only spaces narrows nothing.
  expect(isFiltered({ ...EVERYTHING, search: "   " })).toBe(false);
});

test("every read the page makes is one the API accepts", () => {
  const view: HistoryView = {
    search: "  dune ",
    person: "person-1",
    from: "2026-11-01T07:00:00.000Z",
    to: "2026-11-15T08:00:00.000Z",
  };
  const cursor = "0000000a-0000-4000-8000-000000000019";
  for (const path of [
    historyReadPath(EVERYTHING, null),
    historyReadPath(view, null),
    historyReadPath(view, cursor),
    statisticsReadPath(view),
  ]) {
    expect(PlaybackQuerySchema.safeParse(query(path)).success, path).toBe(true);
  }
  expect(query(historyReadPath(view, cursor))).toEqual({
    search: "dune",
    userId: "person-1",
    from: "2026-11-01T07:00:00.000Z",
    to: "2026-11-15T08:00:00.000Z",
    limit: "25",
    cursor,
  });
  // The statistics follow the same filters as the list.
  expect(query(statisticsReadPath(view))).toEqual(
    Object.fromEntries(new URLSearchParams(filterKey(view))),
  );
});

test("a day in a date field is the midnight that starts it where the reader is", () => {
  Bun.env.TZ = "America/Los_Angeles";
  expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
    "America/Los_Angeles",
  );
  // Standard time, daylight time, and the two days the clocks change.
  expect(dayStart("2026-11-15")).toBe("2026-11-15T08:00:00.000Z");
  expect(dayStart("2026-07-04")).toBe("2026-07-04T07:00:00.000Z");
  expect(dayStart("2026-03-08")).toBe("2026-03-08T08:00:00.000Z");
  expect(dayStart("2026-11-01")).toBe("2026-11-01T07:00:00.000Z");
  for (const day of ["2026-11-15", "2026-07-04", "2026-03-08", "2026-11-01"]) {
    expect(localDay(dayStart(day))).toBe(day);
  }
  // A moment late in the evening there is the next day in UTC.
  expect(localDay("2026-11-16T05:30:00.000Z")).toBe("2026-11-15");

  Bun.env.TZ = "Pacific/Kiritimati";
  expect(dayStart("2026-11-15")).toBe("2026-11-14T10:00:00.000Z");
  expect(localDay(dayStart("2026-11-15"))).toBe("2026-11-15");

  // An emptied or half-typed field names no day.
  expect(dayStart("")).toBeNull();
  expect(dayStart("2026-02-30")).toBeNull();
  expect(localDay(null)).toBeNull();
});
