import { describe, expect, it } from "vitest";
import { localToday, monthOf, shiftMonth } from "#client/calendar/dates.ts";
import { releaseDays } from "#client/calendar/events.ts";
import { calendarReadPath, visibleRange } from "#client/calendar/view.ts";
import { readEveryPage } from "#client/ui/use-cursor-list.ts";
import { CalendarPageSchema } from "#shared/household/calendar.ts";
import { BUSY_DAY } from "./fixtures/calendar.ts";
import { routeFixture } from "./router.ts";
import type { FixtureScenario } from "./scenario.ts";

const THIS_MONTH = monthOf(localToday());

/** One calendar read, as the client makes it. */
function read(path: string, scenario: FixtureScenario = "default") {
  const outcome = routeFixture({
    method: "GET",
    url: new URL(`http://fixture.invalid/api/v1${path}`),
    persona: "member",
    scenario,
  });
  if (outcome.status !== 200) {
    throw new Error(`${path}: HTTP ${String(outcome.status)}`);
  }
  return CalendarPageSchema.parse(outcome.body);
}

function month(name: string, limit?: number) {
  const range = visibleRange(name, "agenda");
  const path = (cursor: string | null) => {
    const whole = calendarReadPath(
      { kind: "all", status: "all" },
      range,
      cursor,
    );
    return limit === undefined
      ? whole
      : whole.replace("limit=100", `limit=${String(limit)}`);
  };
  return { range, path };
}

describe("the calendar fixture", () => {
  it("has a day with more releases than a square lists, and releases with no date", () => {
    const { days, undated } = releaseDays(
      read(month(THIS_MONTH).path(null)).events,
    );
    const busy = `${THIS_MONTH}-${String(BUSY_DAY).padStart(2, "0")}`;
    expect(days.get(busy)?.length).toBeGreaterThan(3);
    // Episodes and film releases share the day.
    expect(
      new Set(days.get(busy)?.map((event) => event.kind)).size,
    ).toBeGreaterThan(2);
    expect(undated.length).toBeGreaterThan(1);
    expect(undated.every((event) => event.precision === "unknown")).toBe(true);
  });

  it("answers the months either side, and sends the undated with every range", () => {
    for (const offset of [-1, 1, 6]) {
      const name = shiftMonth(THIS_MONTH, offset);
      const { range, path } = month(name);
      const { days, undated } = releaseDays(read(path(null)).events);
      expect(undated.length, name).toBeGreaterThan(1);
      expect(days.size > 0, name).toBe(offset !== 6);
      for (const date of days.keys()) {
        expect(date >= range.from && date <= range.to, date).toBe(true);
      }
    }
  });

  it("pages like the server: following the cursor reads the whole range once", async () => {
    const whole = read(month(THIS_MONTH).path(null));
    expect(whole.nextCursor).toBeNull();

    const { path } = month(THIS_MONTH, 7);
    const first = read(path(null));
    expect(first.events).toHaveLength(7);
    expect(first.nextCursor).not.toBeNull();
    let reads = 0;
    const followed = await readEveryPage((cursor) => {
      reads += 1;
      const page = read(path(cursor));
      return Promise.resolve({
        items: page.events,
        nextCursor: page.nextCursor,
      });
    });
    expect(reads).toBe(Math.ceil(whole.events.length / 7));
    expect(followed.items.map((event) => event.id)).toEqual(
      whole.events.map((event) => event.id),
    );
    // Dated first in date order, the undated last, as the API orders them.
    const dates = whole.events.map((event) => event.date);
    expect(dates).toEqual(
      [...dates].sort((left, right) => {
        if (left === right) return 0;
        if (left === null) return 1;
        return right === null ? -1 : left.localeCompare(right);
      }),
    );
  });

  it("is empty for a household that has asked for nothing", () => {
    expect(read(month(THIS_MONTH).path(null), "new-household")).toEqual({
      events: [],
      nextCursor: null,
    });
  });
});
