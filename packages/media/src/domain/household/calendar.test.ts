import { describe, expect, test } from "vitest";
import { normalizeMovieReleases, seriesLifecycleStatus } from "./calendar.ts";
import {
  CalendarQuerySchema,
  RemovalHistoryQuerySchema,
} from "#shared/household/calendar.ts";

describe("calendar catalog semantics", () => {
  test("US release types remain distinct civil dates without regional or timezone substitution", () => {
    expect(
      normalizeMovieReleases([
        {
          iso_3166_1: "GB",
          release_dates: [
            { type: 4, release_date: "2026-11-12T00:00:00.000Z" },
          ],
        },
        {
          iso_3166_1: "US",
          release_dates: [
            { type: 2, release_date: "2026-11-13T00:00:00.000Z" },
            { type: 3, release_date: "2026-11-13T00:00:00.000Z" },
            { type: 4, release_date: "2026-11-20T00:00:00.000Z" },
            { type: 5, release_date: "" },
            { type: 6, release_date: "2026-12-01T00:00:00.000Z" },
          ],
        },
      ]),
    ).toEqual([
      {
        kind: "theatrical",
        region: "US",
        date: "2026-11-13",
        precision: "day",
      },
      { kind: "digital", region: "US", date: "2026-11-20", precision: "day" },
      { kind: "physical", region: "US", date: null, precision: "unknown" },
    ]);
  });
  test("unknown movie dates are honestly TBA rather than the global movie release date", () => {
    expect(normalizeMovieReleases([])).toHaveLength(3);
    expect(
      normalizeMovieReleases([]).every(
        (row) => row.date === null && row.precision === "unknown",
      ),
    ).toBe(true);
    expect(() =>
      normalizeMovieReleases([
        {
          iso_3166_1: "US",
          release_dates: [{ type: 4, release_date: "2026-02-31T00:00:00Z" }],
        },
      ]),
    ).toThrow();
  });
  test("only known TMDB terminal states count as terminal", () => {
    expect(seriesLifecycleStatus("Ended")).toBe("ended");
    expect(seriesLifecycleStatus("Canceled")).toBe("cancelled");
    expect(seriesLifecycleStatus("Returning Series")).toBe("continuing");
    expect(seriesLifecycleStatus(undefined)).toBe("unknown");
    expect(seriesLifecycleStatus("New upstream status")).toBe("unknown");
  });
  test("bounded calendar queries and cursors reject invalid input", () => {
    expect(
      CalendarQuerySchema.safeParse({ from: "2026-11-01", to: "2027-11-01" })
        .success,
    ).toBe(false);
    expect(
      CalendarQuerySchema.safeParse({ from: "2026-11-20", to: "2026-11-01" })
        .success,
    ).toBe(false);
    expect(
      CalendarQuerySchema.safeParse({
        from: "2026-11-01",
        to: "2026-11-30",
        cursor: "{}",
      }).success,
    ).toBe(false);
    expect(
      RemovalHistoryQuerySchema.safeParse({ cursor: "not-json" }).success,
    ).toBe(false);
    expect(
      CalendarQuerySchema.parse({ from: "2026-11-01", to: "2026-11-30" }).limit,
    ).toBe(100);
  });
});
